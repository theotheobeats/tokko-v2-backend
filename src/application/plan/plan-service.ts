/**
 * PlanService — resolves a store's effective tier and builds the plan view
 * exposed to the API. Domain rules live in domain/plan (pure), this wires
 * them to the subscription repository.
 */

import type { Store } from "../../domain/store/store";
import { resolveTier, tierConfigFor, ROYALTY_RATE, type Tier, type TierConfig } from "../../domain/plan/types";
import type { SubscriptionRepository } from "../../infrastructure/repos/d1-subscription-repo";

/** Plan info attached to store payloads (owner + public storefront). */
export interface PlanView {
  tier: Tier;
  trialEndsAt: string | null;
  /** Trial expired → store readable but orders off (trial-lifecycle cron). */
  paused: boolean;
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
  /** Scheduled next-term plan change (paid now, applies at period end). */
  pendingPlan: "pro" | "commerce" | null;
  pendingCycle: "monthly" | "annual" | null;
  pendingStartsAt: string | null;
  /** End of the current paid term (null when none). */
  currentPeriodEnd: string | null;
  /** Cancel at period end — keeps working until the term ends, then no renewal. */
  cancelAtPeriodEnd: boolean;
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
    const sub = await this.subscriptionRepo.findActiveByStoreId(store.id);
    const tier = resolveTier(store, sub);
    const cfg = tierConfigFor(tier);
    return {
      tier,
      trialEndsAt: store.trialEndsAt,
      paused: store.isPaused,
      watermark: !cfg.brandingRemoved,
      onlineCheckout: cfg.onlineCheckout,
      payouts: cfg.payouts,
      productLimit: cfg.productLimit,
      aiStoreUsed: store.aiStoreGenerations,
      aiStoreLimit: cfg.aiStoreLimit,
      aiDescriptionUsed: store.aiDescriptions,
      aiDescriptionLimit: cfg.aiDescriptionLimit,
      retentionDays: cfg.retentionDays,
      commissionRate: tier === "pro" || tier === "commerce" ? (store.commissionRate ?? ROYALTY_RATE) : null,
      pendingPlan: sub?.pendingPlan ?? null,
      pendingCycle: sub?.pendingCycle ?? null,
      pendingStartsAt: sub?.pendingPlan ? sub.currentPeriodEnd : null,
      currentPeriodEnd: sub?.currentPeriodEnd ?? null,
      cancelAtPeriodEnd: sub?.cancelAtPeriodEnd ?? false,
    };
  }

  /** Online checkout (hosted payment) availability comes from the tier config — all tiers have it. */
  async canUseOnlineCheckout(store: Store): Promise<boolean> {
    return tierConfigFor(await this.tierOf(store)).onlineCheckout;
  }
}
