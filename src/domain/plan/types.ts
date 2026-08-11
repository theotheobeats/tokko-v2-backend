/**
 * Plan bounded context — tiers, feature matrix and pure tier resolution.
 *
 * Tier matrix (v2 — approved):
 *   trial   14 days · full Pro features · Tokko watermark · AI 1x/10x caps
 *   pro     Rp 49rb/mo (490rb/yr) · watermark removed · unlimited AI
 *   commerce Rp 99–149rb/mo · online checkout (Xendit) + payouts · post-PG
 */

import type { Store } from "../store/store";
import type { Subscription } from "./subscription";

export const Tier = {
  Trial: "trial",
  Pro: "pro",
  Commerce: "commerce",
  None: "none",
} as const;
export type Tier = (typeof Tier)[keyof typeof Tier];

export type Plan = "pro" | "commerce";
export type BillingCycle = "monthly" | "annual";
export type SubscriptionStatus = "active" | "expired" | "canceled";

/** Feature/limit set per tier. null limit = unlimited. */
export interface TierConfig {
  productLimit: number;
  aiStoreLimit: number | null;
  aiDescriptionLimit: number | null;
  onlineCheckout: boolean; // Xendit hosted invoice
  payouts: boolean;
  brandingRemoved: boolean; // Tokko watermark hidden
  retentionDays: number; // order history visibility window
}

export const TIER_CONFIG: Record<Exclude<Tier, "none">, TierConfig> = {
  trial: {
    productLimit: 50,
    aiStoreLimit: 1,
    aiDescriptionLimit: 10,
    onlineCheckout: true, // trial = full Pro features — checkout included
    payouts: false,
    brandingRemoved: false,
    retentionDays: 31,
  },
  pro: {
    productLimit: 1000,
    aiStoreLimit: null,
    aiDescriptionLimit: null,
    onlineCheckout: true, // online checkout is available on Pro & Commerce
    payouts: false,
    brandingRemoved: true,
    retentionDays: 365,
  },
  commerce: {
    productLimit: 5000,
    aiStoreLimit: null,
    aiDescriptionLimit: null,
    onlineCheckout: true,
    payouts: true,
    brandingRemoved: true,
    retentionDays: 1095,
  },
};

/** Abuse guardrail for every tier — no legitimate UMKM store hits this. */
export const HARD_PRODUCT_CAP = 10000;

/** Paid plans (subscriptions). */
export const PAID_PLANS: Plan[] = ["pro", "commerce"];

/**
 * Effective tier for a store:
 *   1. active subscription (status active, period not expired) → its plan
 *   2. trial deadline still in the future → trial
 *   3. otherwise → none (Phase 2: store paused by the trial-expiry cron)
 */
export function resolveTier(store: Pick<Store, "isTrialActive">, subscription: Subscription | null): Tier {
  if (subscription && subscription.isActive) {
    return subscription.plan === "commerce" ? Tier.Commerce : Tier.Pro;
  }
  if (store.isTrialActive) return Tier.Trial;
  return Tier.None;
}

/** Config for the effective tier; "none" falls back to trial caps (paused store). */
export function tierConfigFor(tier: Tier): TierConfig {
  if (tier === Tier.None) return TIER_CONFIG.trial;
  return TIER_CONFIG[tier];
}
