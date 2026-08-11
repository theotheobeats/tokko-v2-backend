import { describe, it, expect, vi } from "vitest";
import {
  pendingPlanExternalId,
  parsePendingPlanExternalId,
  priceFor,
  PENDING_PLAN_EXTERNAL_ID_PREFIX,
} from "../../../src/domain/plan/pricing";
import {
  HandlePendingPlanPayment,
  PendingPlanAmountMismatchError,
} from "../../../src/application/plan/pending-plan";
import type { PendingPlanRepository } from "../../../src/infrastructure/repos/d1-pending-plan-repo";
import { Store } from "../../../src/domain/store/store";
import { BusinessType, Aesthetic } from "../../../src/domain/store/types";
import type { StoreRepository } from "../../../src/application/store/store-repo";
import type { SubscriptionRepository } from "../../../src/infrastructure/repos/d1-subscription-repo";

const USER_ID = "user-123";
const DAY = 86_400_000;

function stubRepo(): { repo: PendingPlanRepository; saved: unknown[] } {
  const saved: unknown[] = [];
  const repo = {
    findByUserIdConsumable: vi.fn().mockResolvedValue(null),
    save: vi.fn(async (row: unknown) => { saved.push(row); }),
    markConsumed: vi.fn().mockResolvedValue(undefined),
  } as unknown as PendingPlanRepository;
  return { repo, saved };
}

describe("pending-plan external-id", () => {
  it("round-trips the pre-store plan external_id", () => {
    const id = pendingPlanExternalId(USER_ID, "commerce", "annual", "n1");
    expect(id.startsWith(PENDING_PLAN_EXTERNAL_ID_PREFIX)).toBe(true);
    expect(parsePendingPlanExternalId(id)).toEqual({
      userId: USER_ID,
      plan: "commerce",
      cycle: "annual",
      nonce: "n1",
    });
  });

  it("rejects malformed ids and non-pending ids", () => {
    expect(parsePendingPlanExternalId("tokko-pre::user::nope::annual::1")).toBeNull();
    expect(parsePendingPlanExternalId("tokko-sub::x::pro::monthly::1")).toBeNull();
    expect(parsePendingPlanExternalId("")).toBeNull();
  });
});

describe("HandlePendingPlanPayment", () => {
  it("records a pending plan on a paid, amount-verified invoice", async () => {
    const { repo, saved } = stubRepo();
    const uc = new HandlePendingPlanPayment(repo);

    const result = await uc.execute({
      external_id: pendingPlanExternalId(USER_ID, "pro", "annual", "n1"),
      status: "PAID",
      amount: priceFor("pro", "annual"),
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ handled: true, plan: "pro", activated: false });
    expect(saved.length).toBe(1);
    const row = saved[0] as { userId: string; plan: string; cycle: string; currentPeriodEnd: string };
    expect(row.userId).toBe(USER_ID);
    expect(row.plan).toBe("pro");
    expect(row.cycle).toBe("annual");
    expect(row.currentPeriodEnd).toBeDefined();
  });

  it("rejects a paid invoice with a mismatched amount", async () => {
    const { repo, saved } = stubRepo();
    const uc = new HandlePendingPlanPayment(repo);

    const result = await uc.execute({
      external_id: pendingPlanExternalId(USER_ID, "commerce", "monthly", "n1"),
      status: "PAID",
      amount: 100,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(PendingPlanAmountMismatchError);
    expect(saved.length).toBe(0);
  });

  it("ignores non-PAID statuses", async () => {
    const { repo, saved } = stubRepo();
    const uc = new HandlePendingPlanPayment(repo);

    const result = await uc.execute({
      external_id: pendingPlanExternalId(USER_ID, "pro", "monthly", "n1"),
      status: "EXPIRED",
      amount: priceFor("pro", "monthly"),
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.handled).toBe(false);
    expect(saved.length).toBe(0);
  });

  it("activates directly on the user's existing store (webhook lands after onboarding)", async () => {
    const store = Store.create({
      ownerId: USER_ID as never,
      name: "Race Store",
      businessType: BusinessType.Food,
      aestheticPreference: Aesthetic.Minimal,
      whatsappNumber: "081234567890",
    });
    store.setTrialEndsAt(new Date(Date.now() + 5 * DAY).toISOString());
    const storeRepo = {
      findByOwnerId: vi.fn().mockResolvedValue(store),
      save: vi.fn().mockResolvedValue(undefined),
    } as unknown as StoreRepository;
    const subRepo = { save: vi.fn().mockResolvedValue(undefined) } as unknown as SubscriptionRepository;

    const saved: unknown[] = [];
    const repo = {
      findByUserIdConsumable: vi.fn().mockResolvedValue(null),
      save: vi.fn(async (row: unknown) => { saved.push(row); }),
      markConsumed: vi.fn().mockResolvedValue(undefined),
    } as unknown as PendingPlanRepository;

    const uc = new HandlePendingPlanPayment(repo, storeRepo, subRepo);
    const result = await uc.execute({
      external_id: pendingPlanExternalId(USER_ID, "pro", "monthly", "n1"),
      status: "PAID",
      amount: priceFor("pro", "monthly"),
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ handled: true, plan: "pro", activated: true });
    // Subscription created on the store, trial cleared, pending row consumed.
    expect(subRepo.save).toHaveBeenCalled();
    expect(store.trialEndsAt).toBeNull();
    expect(saved[0]).toMatchObject({ status: "consumed", userId: USER_ID });
  });
});
