import { describe, it, expect, vi } from "vitest";
import {
  priceFor,
  subscriptionExternalId,
  parseSubscriptionExternalId,
  SUBSCRIPTION_EXTERNAL_ID_PREFIX,
} from "../../../src/domain/plan/pricing";
import { HandleSubscriptionInvoice, SubscriptionAmountMismatchError, SubscriptionStoreNotFoundError } from "../../../src/application/plan/subscription-webhook";
import type { StoreRepository } from "../../../src/application/store/store-repo";
import type { SubscriptionRepository } from "../../../src/infrastructure/repos/d1-subscription-repo";
import { Store } from "../../../src/domain/store/store";
import { BusinessType, Aesthetic } from "../../../src/domain/store/types";
import { createEntityId } from "../../../src/domain/shared/types";
import { Subscription } from "../../../src/domain/plan/subscription";

const STORE_ID = createEntityId();
const DAY = 86_400_000;

function makeStore(): Store {
  const store = Store.create({
    ownerId: createEntityId(),
    name: "Billing Store",
    businessType: BusinessType.Food,
    aestheticPreference: Aesthetic.Minimal,
    whatsappNumber: "081234567890",
  });
  return store;
}

function stubRepos(store: Store | null, existing: Subscription | null) {
  const storeRepo = {
    findById: vi.fn().mockResolvedValue(store),
    save: vi.fn().mockResolvedValue(undefined),
  } as unknown as StoreRepository;
  const subRepo = {
    findActiveByStoreId: vi.fn().mockResolvedValue(existing),
    save: vi.fn().mockResolvedValue(undefined),
  } as unknown as SubscriptionRepository;
  return { storeRepo, subRepo };
}

describe("pricing + external-id identity", () => {
  it("has the approved SKU prices", () => {
    expect(priceFor("pro", "monthly")).toBe(49_000);
    expect(priceFor("pro", "annual")).toBe(490_000);
    expect(priceFor("commerce", "monthly")).toBe(99_000);
    expect(priceFor("commerce", "annual")).toBe(990_000);
  });

  it("round-trips the subscription external_id", () => {
    const id = subscriptionExternalId(STORE_ID, "commerce", "annual", "abc123");
    expect(id.startsWith(SUBSCRIPTION_EXTERNAL_ID_PREFIX)).toBe(true);
    expect(parseSubscriptionExternalId(id)).toEqual({
      storeId: STORE_ID,
      plan: "commerce",
      cycle: "annual",
      nonce: "abc123",
    });
  });

  it("rejects malformed or non-subscription ids", () => {
    expect(parseSubscriptionExternalId("tokko-sub::store::nope::monthly::1")).toBeNull();
    expect(parseSubscriptionExternalId("tokko-other-id")).toBeNull();
    expect(parseSubscriptionExternalId("")).toBeNull();
  });
});

describe("HandleSubscriptionInvoice", () => {
  it("activates a plan on a paid, amount-verified invoice", async () => {
    const store = makeStore();
    store.setTrialEndsAt(new Date(Date.now() + 2 * DAY).toISOString());
    const { storeRepo, subRepo } = stubRepos(store, null);
    const uc = new HandleSubscriptionInvoice(storeRepo, subRepo);

    const result = await uc.execute({
      external_id: subscriptionExternalId(store.id, "pro", "annual", "n1"),
      status: "PAID",
      amount: 490_000,
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ handled: true, plan: "pro", cycle: "annual", renewal: false });
    expect(subRepo.save).toHaveBeenCalled();
    // Payment clears the trial and resumes the store.
    expect(store.trialEndsAt).toBeNull();
  });

  it("rejects a paid invoice whose amount does not match pricing", async () => {
    const store = makeStore();
    const { storeRepo, subRepo } = stubRepos(store, null);
    const uc = new HandleSubscriptionInvoice(storeRepo, subRepo);

    const result = await uc.execute({
      external_id: subscriptionExternalId(store.id, "pro", "monthly", "n1"),
      status: "PAID",
      amount: 500, // forged / wrong price
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(SubscriptionAmountMismatchError);
    expect(subRepo.save).not.toHaveBeenCalled();
  });

  it("ignores non-PAID statuses (no pending state)", async () => {
    const store = makeStore();
    const { storeRepo, subRepo } = stubRepos(store, null);
    const uc = new HandleSubscriptionInvoice(storeRepo, subRepo);

    const result = await uc.execute({
      external_id: subscriptionExternalId(store.id, "pro", "monthly", "n1"),
      status: "EXPIRED",
      amount: 49_000,
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.handled).toBe(false);
    expect(subRepo.save).not.toHaveBeenCalled();
  });

  it("extends an existing subscription from its current period end", async () => {
    const store = makeStore();
    const existing = Subscription.create({
      id: createEntityId(),
      storeId: store.id,
      plan: "pro",
      cycle: "monthly",
      currentPeriodEnd: new Date(Date.now() + 10 * DAY).toISOString(),
    });
    const { storeRepo, subRepo } = stubRepos(store, existing);
    const uc = new HandleSubscriptionInvoice(storeRepo, subRepo);

    // Same plan+cycle → renewal: extends the period.
    const result = await uc.execute({
      external_id: subscriptionExternalId(store.id, "pro", "monthly", "n2"),
      status: "PAID",
      amount: 49_000,
    });

    expect(result.ok).toBe(true);
    const saved = (subRepo.save as ReturnType<typeof vi.fn>).mock.calls[0][0] as Subscription;
    expect(saved.currentPeriodEnd).toBe(new Date(new Date(existing.currentPeriodEnd!).getTime() + 31 * DAY).toISOString());
    expect(saved.pendingPlan).toBeNull();
    if (result.ok) expect(result.value.renewal).toBe(true);
  });

  it("schedules a plan CHANGE for the next term (no immediate switch, no extension)", async () => {
    const store = makeStore();
    const existing = Subscription.create({
      id: createEntityId(),
      storeId: store.id,
      plan: "pro",
      cycle: "annual",
      currentPeriodEnd: new Date(Date.now() + 100 * DAY).toISOString(),
    });
    const { storeRepo, subRepo } = stubRepos(store, existing);
    const uc = new HandleSubscriptionInvoice(storeRepo, subRepo);

    // Different plan → prepaid CHANGE: pending_plan set, current period untouched.
    const result = await uc.execute({
      external_id: subscriptionExternalId(store.id, "commerce", "annual", "n3"),
      status: "PAID",
      amount: 990_000,
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.renewal).toBe(false);
    const saved = (subRepo.save as ReturnType<typeof vi.fn>).mock.calls[0][0] as Subscription;
    expect(saved.plan).toBe("pro"); // still pro until the term ends
    expect(saved.pendingPlan).toBe("commerce");
    expect(saved.pendingCycle).toBe("annual");
    expect(saved.currentPeriodEnd).toBe(existing.currentPeriodEnd); // no extension
  });

  it("returns store-not-found for an unknown store", async () => {
    const { storeRepo, subRepo } = stubRepos(null, null);
    const uc = new HandleSubscriptionInvoice(storeRepo, subRepo);
    const result = await uc.execute({
      external_id: subscriptionExternalId(STORE_ID, "pro", "monthly", "n1"),
      status: "PAID",
      amount: 49_000,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(SubscriptionStoreNotFoundError);
  });
});
