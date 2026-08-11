import { describe, it, expect, vi } from "vitest";
import {
  CancelSubscription,
  SubscriptionAlreadyCanceledError,
  SubscriptionChangePendingError,
  SubscriptionNotFoundError,
} from "../../../src/application/plan/cancel-subscription";
import type { SubscriptionRepository } from "../../../src/infrastructure/repos/d1-subscription-repo";
import { Subscription } from "../../../src/domain/plan/subscription";
import { createEntityId } from "../../../src/domain/shared/types";

const STORE_ID = createEntityId();
const DAY = 86_400_000;

function activeSub(overrides: Partial<Parameters<typeof Subscription.create>[0]> = {}): Subscription {
  return Subscription.create({
    id: createEntityId(),
    storeId: STORE_ID,
    plan: "pro",
    cycle: "annual",
    currentPeriodEnd: new Date(Date.now() + 100 * DAY).toISOString(),
    ...overrides,
  });
}

function stubRepo(sub: Subscription | null) {
  const repo = {
    findActiveByStoreId: vi.fn().mockResolvedValue(sub),
    save: vi.fn().mockResolvedValue(undefined),
  } as unknown as SubscriptionRepository;
  return repo;
}

describe("CancelSubscription", () => {
  it("sets cancelAtPeriodEnd without touching the current plan or period", async () => {
    const sub = activeSub();
    const repo = stubRepo(sub);
    const result = await new CancelSubscription(repo).execute({ storeId: STORE_ID, cancel: true });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ cancelAtPeriodEnd: true, currentPeriodEnd: sub.currentPeriodEnd });
    const saved = (repo.save as ReturnType<typeof vi.fn>).mock.calls[0][0] as Subscription;
    expect(saved.cancelAtPeriodEnd).toBe(true);
    expect(saved.plan).toBe("pro"); // plan untouched until period end
    expect(saved.currentPeriodEnd).toBe(sub.currentPeriodEnd);
  });

  it("resumes a canceled subscription", async () => {
    const sub = activeSub({ cancelAtPeriodEnd: true });
    const repo = stubRepo(sub);
    const result = await new CancelSubscription(repo).execute({ storeId: STORE_ID, cancel: false });

    expect(result.ok).toBe(true);
    const saved = (repo.save as ReturnType<typeof vi.fn>).mock.calls[0][0] as Subscription;
    expect(saved.cancelAtPeriodEnd).toBe(false);
  });

  it("rejects canceling twice", async () => {
    const repo = stubRepo(activeSub({ cancelAtPeriodEnd: true }));
    const result = await new CancelSubscription(repo).execute({ storeId: STORE_ID, cancel: true });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(SubscriptionAlreadyCanceledError);
  });

  it("blocks cancel while a pending plan change exists", async () => {
    const repo = stubRepo(activeSub({ pendingPlan: "commerce", pendingCycle: "annual" }));
    const result = await new CancelSubscription(repo).execute({ storeId: STORE_ID, cancel: true });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(SubscriptionChangePendingError);
  });

  it("returns not-found when there is no active subscription", async () => {
    const repo = stubRepo(null);
    const result = await new CancelSubscription(repo).execute({ storeId: STORE_ID, cancel: true });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(SubscriptionNotFoundError);
  });
});
