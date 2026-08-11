import { describe, it, expect } from "vitest";
import { Store } from "../../../src/domain/store/store";
import { BusinessType, Aesthetic } from "../../../src/domain/store/types";
import { createEntityId } from "../../../src/domain/shared/types";
import {
  resolveTier,
  tierConfigFor,
  TIER_CONFIG,
  HARD_PRODUCT_CAP,
  Tier,
} from "../../../src/domain/plan/types";
import { Subscription } from "../../../src/domain/plan/subscription";

const ownerId = createEntityId();

function makeStore(trialEndsAt: string | null): Store {
  const store = Store.create({
    ownerId,
    name: "Test Store",
    businessType: BusinessType.Food,
    aestheticPreference: Aesthetic.Minimal,
    whatsappNumber: "081234567890",
  });
  store.setTrialEndsAt(trialEndsAt);
  return store;
}

function sub(overrides: Partial<Parameters<typeof Subscription.create>[0]> = {}): Subscription {
  return Subscription.create({
    id: createEntityId(),
    storeId: createEntityId(),
    plan: "pro",
    cycle: "monthly",
    currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    ...overrides,
  });
}

describe("resolveTier", () => {
  it("returns trial while the trial deadline is in the future", () => {
    const store = makeStore(new Date(Date.now() + 3 * 86_400_000).toISOString());
    expect(resolveTier(store, null)).toBe(Tier.Trial);
  });

  it("returns none when no subscription and the trial has lapsed", () => {
    const store = makeStore(new Date(Date.now() - 86_400_000).toISOString());
    expect(resolveTier(store, null)).toBe(Tier.None);
  });

  it("returns none when there is no trial at all", () => {
    expect(resolveTier(makeStore(null), null)).toBe(Tier.None);
  });

  it("an active pro subscription wins over a live trial", () => {
    const store = makeStore(new Date(Date.now() + 3 * 86_400_000).toISOString());
    expect(resolveTier(store, sub({ plan: "pro" }))).toBe(Tier.Pro);
  });

  it("an active commerce subscription resolves to commerce", () => {
    expect(resolveTier(makeStore(null), sub({ plan: "commerce" }))).toBe(Tier.Commerce);
  });

  it("an expired subscription falls back to the trial window", () => {
    const store = makeStore(new Date(Date.now() + 3 * 86_400_000).toISOString());
    const expired = sub({ status: "expired" });
    expect(expired.isActive).toBe(false);
    expect(resolveTier(store, expired)).toBe(Tier.Trial);
  });

  it("a canceled subscription with a lapsed period resolves to none", () => {
    const store = makeStore(null);
    const canceled = sub({ status: "canceled" });
    expect(resolveTier(store, canceled)).toBe(Tier.None);
  });
});

describe("tierConfigFor", () => {
  it("applies the approved tier matrix limits", () => {
    expect(tierConfigFor(Tier.Trial).productLimit).toBe(50);
    expect(tierConfigFor(Tier.Pro).productLimit).toBe(1000);
    expect(tierConfigFor(Tier.Commerce).productLimit).toBe(5000);
  });

  it("trial caps AI usage (1 store gen, 10 descriptions) and paid plans are unlimited", () => {
    expect(tierConfigFor(Tier.Trial).aiStoreLimit).toBe(1);
    expect(tierConfigFor(Tier.Trial).aiDescriptionLimit).toBe(10);
    expect(tierConfigFor(Tier.Pro).aiStoreLimit).toBeNull();
    expect(tierConfigFor(Tier.Pro).aiDescriptionLimit).toBeNull();
  });

  it("online checkout is available on Pro & Commerce, payouts are commerce-only", () => {
    expect(tierConfigFor(Tier.Trial).onlineCheckout).toBe(false);
    expect(tierConfigFor(Tier.Pro).onlineCheckout).toBe(true);
    expect(tierConfigFor(Tier.Commerce).onlineCheckout).toBe(true);
    expect(tierConfigFor(Tier.Commerce).payouts).toBe(true);
  });

  it("the Tokko watermark is removed from pro and commerce", () => {
    expect(tierConfigFor(Tier.Trial).brandingRemoved).toBe(false);
    expect(tierConfigFor(Tier.Pro).brandingRemoved).toBe(true);
    expect(tierConfigFor(Tier.Commerce).brandingRemoved).toBe(true);
  });

  it("retention windows follow the ScaleV mechanic (31d / 1y / 3y)", () => {
    expect(tierConfigFor(Tier.Trial).retentionDays).toBe(31);
    expect(tierConfigFor(Tier.Pro).retentionDays).toBe(365);
    expect(tierConfigFor(Tier.Commerce).retentionDays).toBe(1095);
  });

  it("none falls back to trial caps and the hard cap stays at 10000", () => {
    expect(tierConfigFor(Tier.None).productLimit).toBe(TIER_CONFIG.trial.productLimit);
    expect(HARD_PRODUCT_CAP).toBe(10000);
  });
});

describe("Subscription.isActive", () => {
  it("is active when status is active and the period is still open", () => {
    expect(sub().isActive).toBe(true);
  });

  it("is inactive once the period ends", () => {
    const past = sub({ currentPeriodEnd: new Date(Date.now() - 86_400_000).toISOString() });
    expect(past.isActive).toBe(false);
  });

  it("a null period end means active for as long as the status says so", () => {
    expect(sub({ currentPeriodEnd: null }).isActive).toBe(true);
  });
});

describe("Store plan fields", () => {
  it("tracks AI usage counters and trial window", () => {
    const store = Store.create({
      ownerId,
      name: "Counter Store",
      businessType: BusinessType.Beauty,
      aestheticPreference: Aesthetic.Bold,
      whatsappNumber: "081234567890",
    });
    expect(store.aiStoreGenerations).toBe(0);
    expect(store.aiDescriptions).toBe(0);
    expect(store.isTrialActive).toBe(false);

    store.incrementAiStoreGenerations();
    store.incrementAiDescriptions();
    store.incrementAiDescriptions();
    expect(store.aiStoreGenerations).toBe(1);
    expect(store.aiDescriptions).toBe(2);

    store.setTrialEndsAt(new Date(Date.now() + 86_400_000).toISOString());
    expect(store.isTrialActive).toBe(true);
    store.setTrialEndsAt(new Date(Date.now() - 86_400_000).toISOString());
    expect(store.isTrialActive).toBe(false);
    store.setTrialEndsAt(null);
    expect(store.isTrialActive).toBe(false);
  });

  it("stores commission rate and custom domain", () => {
    const store = Store.create({
      ownerId,
      name: "Comm Store",
      businessType: BusinessType.Fashion,
      aestheticPreference: Aesthetic.Minimal,
      whatsappNumber: "081234567890",
    });
    expect(store.commissionRate).toBeNull();
    store.setCommissionRate(3.5);
    expect(store.commissionRate).toBe(3.5);
    store.setCustomDomain("toko.example.com");
    expect(store.customDomain).toBe("toko.example.com");
  });
});
