/**
 * Subscription pricing + invoice identity (Phase 3 — billing).
 *
 * Two price sets:
 *   BETA (current, default) — test pricing:
 *     Pro      Rp 49.000/bln  · Commerce Rp 99.000/bln
 *   NORMAL (post-beta) — flip `pricing_beta` app setting to "0":
 *     Pro      Rp 99.000/bln  · Commerce Rp 179.000/bln
 *
 * Annual is ALWAYS 2 months free (annual = 10 × monthly) in both modes.
 *
 * Subscription invoices are provider invoices with a namespaced external_id:
 *   tokko-sub::<storeId>::<plan>::<cycle>::<nonce>
 * The webhook parses it back (amount is re-verified against pricing, same
 * forgery-guard pattern as order payments) and accepts BOTH price sets so
 * invoices created before a beta→normal flip still activate.
 */

import type { Plan, BillingCycle } from "./types";

/** BETA test pricing (monthly) — the current default. */
export const BETA_MONTHLY: Record<Plan, number> = {
  pro: 49_000,
  commerce: 99_000,
};

/** NORMAL pricing (monthly) — applies when out of beta. */
export const PRICE_MONTHLY: Record<Plan, number> = {
  pro: 99_000,
  commerce: 179_000,
};

/** Back-compat alias — the old shape had annual baked in; normal monthly now. */
export const PRICE: Record<Plan, Record<BillingCycle, number>> = {
  pro: { monthly: PRICE_MONTHLY.pro, annual: PRICE_MONTHLY.pro * 10 },
  commerce: { monthly: PRICE_MONTHLY.commerce, annual: PRICE_MONTHLY.commerce * 10 },
};

/** Annual includes 2 free months (pay 10, get 12). */
export const MONTHS_FREE_ANNUAL = 2;
export const ANNUAL_PAID_MONTHS = 12 - MONTHS_FREE_ANNUAL;

export const SUBSCRIPTION_EXTERNAL_ID_PREFIX = "tokko-sub::";

/** Pre-store plan purchase (plan-selection gate at signup). */
export const PENDING_PLAN_EXTERNAL_ID_PREFIX = "tokko-pre::";

/** Days added to current_period_end on activation. */
export const PERIOD_DAYS: Record<BillingCycle, number> = { monthly: 31, annual: 365 };

/** Monthly price for the mode (beta default — current behavior). */
export function monthlyPriceFor(plan: Plan, beta = true): number {
  return (beta ? BETA_MONTHLY : PRICE_MONTHLY)[plan];
}

/** Annual is always 2 months free: pay 10 months, get 12. */
export function annualPriceFor(plan: Plan, beta = true): number {
  return monthlyPriceFor(plan, beta) * ANNUAL_PAID_MONTHS;
}

export function priceFor(plan: Plan, cycle: BillingCycle, beta = true): number {
  return cycle === "monthly" ? monthlyPriceFor(plan, beta) : annualPriceFor(plan, beta);
}

/**
 * Accepts the BETA or the NORMAL price for the plan/cycle — invoices created
 * under either price regime stay valid after a beta→normal flip (grace).
 */
export function isValidInvoiceAmount(amount: number, plan: Plan, cycle: BillingCycle): boolean {
  return amount === priceFor(plan, cycle, true) || amount === priceFor(plan, cycle, false);
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

/** Pre-store plan invoice external_id. */
export function pendingPlanExternalId(userId: string, plan: Plan, cycle: BillingCycle, nonce: string): string {
  return `${PENDING_PLAN_EXTERNAL_ID_PREFIX}${userId}::${plan}::${cycle}::${nonce}`;
}

export interface ParsedPendingPlanInvoice {
  userId: string;
  plan: Plan;
  cycle: BillingCycle;
  nonce: string;
}

/** Parse a pre-store plan invoice external_id; null when not one of ours. */
export function parsePendingPlanExternalId(externalId: string): ParsedPendingPlanInvoice | null {
  if (!externalId.startsWith(PENDING_PLAN_EXTERNAL_ID_PREFIX)) return null;
  const parts = externalId.split("::");
  if (parts.length !== 5) return null;
  const [, userId, plan, cycle, nonce] = parts;
  if (!userId || !nonce) return null;
  if (plan !== "pro" && plan !== "commerce") return null;
  if (cycle !== "monthly" && cycle !== "annual") return null;
  return { userId, plan, cycle, nonce };
}
