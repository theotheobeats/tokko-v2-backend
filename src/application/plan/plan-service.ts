/**
 * PlanService — resolves a store's effective tier and builds the plan view
 * exposed to the API. Domain rules live in domain/plan (pure), this wires
 * them to the subscription repository.
 */

import type { Store } from "../../domain/store/store";
import { resolveTier, tierConfigFor, type Tier, type TierConfig } from "../../domain/plan/types";
import type { SubscriptionRepository } from "../../infrastructure/repos/d1-subscription-repo";

/** Plan info attached to store payloads (owner + public storefront). */
export interface PlanView {
  tier: Tier;
  trialEndsAt: string | null;
  /** Tokko branding watermark shown on the storefront (trial only). */
  watermark: boolean;
  onlineCheckout: boolean;
  payouts: boolean;
  productLimit: number;
  aiStoreUsed: number;
  aiStoreLimit: number | null;
  aiDescriptionUsed: number;
  aiDescriptionLimit: number | null;
  retentionDays: number;
  commissionRate: number | null;
}

export class PlanService {
  constructor(private readonly subscriptionRepo: SubscriptionRepository) {}

  /** Effective tier: active subscription → pro/commerce; live trial → trial; else none. */
  async tierOf(store: Store): Promise<Tier> {
    const subscription = await this.subscriptionRepo.findActiveByStoreId(store.id);
    return resolveTier(store, subscription);
  }

  /** Full plan view for payloads/gates. */
  async viewOf(store: Store): Promise<PlanView> {
    const tier = await this.tierOf(store);
    const cfg = tierConfigFor(tier);
    return {
      tier,
      trialEndsAt: store.trialEndsAt,
      watermark: !cfg.brandingRemoved,
      onlineCheckout: cfg.onlineCheckout,
      payouts: cfg.payouts,
      productLimit: cfg.productLimit,
      aiStoreUsed: store.aiStoreGenerations,
      aiStoreLimit: cfg.aiStoreLimit,
      aiDescriptionUsed: store.aiDescriptions,
      aiDescriptionLimit: cfg.aiDescriptionLimit,
      retentionDays: cfg.retentionDays,
      commissionRate: store.commissionRate,
    };
  }

  /** Online checkout (Xendit) availability comes from the tier config — all tiers have it. */
  async canUseOnlineCheckout(store: Store): Promise<boolean> {
    return tierConfigFor(await this.tierOf(store)).onlineCheckout;
  }
}
