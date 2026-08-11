/**
 * Subscription pricing + invoice identity (Phase 3 — billing).
 *
 * Prices (v2 spec):
 *   Pro      Rp 49.000/bln · Rp 490.000/thn  (main SKU — annual is the default ask)
 *   Commerce Rp 99.000/bln · Rp 990.000/thn  (post-Xendit; 99→149rb at traction)
 *
 * Subscription invoices are Xendit invoices with a namespaced external_id:
 *   tokko-sub::<storeId>::<plan>::<cycle>::<nonce>
 * The webhook parses it back (amount is re-verified against pricing, same
 * forgery-guard pattern as order payments).
 */

import type { Plan, BillingCycle } from "./types";

export const PRICE: Record<Plan, Record<BillingCycle, number>> = {
  pro: { monthly: 49_000, annual: 490_000 },
  commerce: { monthly: 99_000, annual: 990_000 },
};

export const SUBSCRIPTION_EXTERNAL_ID_PREFIX = "tokko-sub::";

/** Days added to current_period_end on activation. */
export const PERIOD_DAYS: Record<BillingCycle, number> = { monthly: 31, annual: 365 };

export function priceFor(plan: Plan, cycle: BillingCycle): number {
  return PRICE[plan][cycle];
}

export function subscriptionExternalId(storeId: string, plan: Plan, cycle: BillingCycle, nonce: string): string {
  return `${SUBSCRIPTION_EXTERNAL_ID_PREFIX}${storeId}::${plan}::${cycle}::${nonce}`;
}

export interface ParsedSubscriptionInvoice {
  storeId: string;
  plan: Plan;
  cycle: BillingCycle;
  nonce: string;
}

/** Parse a subscription invoice external_id; null when not one of ours. */
export function parseSubscriptionExternalId(externalId: string): ParsedSubscriptionInvoice | null {
  if (!externalId.startsWith(SUBSCRIPTION_EXTERNAL_ID_PREFIX)) return null;
  const parts = externalId.split("::");
  if (parts.length !== 5) return null;
  const [, storeId, plan, cycle, nonce] = parts;
  if (!storeId || !nonce) return null;
  if (plan !== "pro" && plan !== "commerce") return null;
  if (cycle !== "monthly" && cycle !== "annual") return null;
  return { storeId, plan, cycle, nonce };
}
