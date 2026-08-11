import { describe, it, expect, vi } from "vitest";
import { PlanService } from "../../../src/application/plan/plan-service";
import type { SubscriptionRepository } from "../../../src/infrastructure/repos/d1-subscription-repo";
import { Store } from "../../../src/domain/store/store";
import { BusinessType, Aesthetic } from "../../../src/domain/store/types";
import { createEntityId } from "../../../src/domain/shared/types";
import { Subscription } from "../../../src/domain/plan/subscription";
import { Tier } from "../../../src/domain/plan/types";

function stubRepo(active: Subscription | null): SubscriptionRepository {
  return {
    findActiveByStoreId: vi.fn().mockResolvedValue(active),
    listByStoreId: vi.fn().mockResolvedValue(active ? [active] : []),
    listAll: vi.fn().mockResolvedValue(active ? [active] : []),
    save: vi.fn().mockResolvedValue(undefined),
  };
}

function makeStore(trialDaysFromNow: number | null): Store {
  const store = Store.create({
    ownerId: createEntityId(),
    name: "Plan Store",
    businessType: BusinessType.Craft,
    aestheticPreference: Aesthetic.Minimal,
    whatsappNumber: "081234567890",
  });
  store.setTrialEndsAt(trialDaysFromNow === null ? null : new Date(Date.now() + trialDaysFromNow * 86_400_000).toISOString());
  return store;
}

const DAY = 86_400_000;

describe("PlanService", () => {
  it("resolves trial tier for a live trial with no subscription", async () => {
    const service = new PlanService(stubRepo(null));
    expect(await service.tierOf(makeStore(5))).toBe(Tier.Trial);
  });

  it("resolves commerce for an active commerce subscription", async () => {
    const active = Subscription.create({
      id: createEntityId(),
      storeId: createEntityId(),
      plan: "commerce",
      currentPeriodEnd: new Date(Date.now() + 30 * DAY).toISOString(),
    });
    const service = new PlanService(stubRepo(active));
    expect(await service.tierOf(makeStore(5))).toBe(Tier.Commerce);
  });

  it("online checkout is commerce-only", async () => {
    const pro = Subscription.create({
      id: createEntityId(),
      storeId: createEntityId(),
      plan: "pro",
      currentPeriodEnd: new Date(Date.now() + 30 * DAY).toISOString(),
    });
    const service = new PlanService(stubRepo(pro));
    expect(await service.canUseOnlineCheckout(makeStore(null))).toBe(false);
  });

  it("viewOf exposes watermark + limits for a trial store", async () => {
    const service = new PlanService(stubRepo(null));
    const view = await service.viewOf(makeStore(3));
    expect(view.tier).toBe(Tier.Trial);
    expect(view.watermark).toBe(true);
    expect(view.onlineCheckout).toBe(false);
    expect(view.productLimit).toBe(50);
    expect(view.aiDescriptionLimit).toBe(10);
  });

  it("viewOf removes the watermark for paid tiers", async () => {
    const pro = Subscription.create({
      id: createEntityId(),
      storeId: createEntityId(),
      plan: "pro",
      currentPeriodEnd: new Date(Date.now() + 365 * DAY).toISOString(),
    });
    const service = new PlanService(stubRepo(pro));
    const view = await service.viewOf(makeStore(null));
    expect(view.tier).toBe(Tier.Pro);
    expect(view.watermark).toBe(false);
    expect(view.productLimit).toBe(1000);
  });
});
