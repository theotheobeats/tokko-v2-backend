/**
 * Payment provider registry — the single place that knows which payment
 * gateways exist and which one is active.
 *
 * Phase 0: Xendit (existing client, untouched) + SingaPay (client lands in
 * Phase 1). The active provider is stored in `app_settings` (`payment_provider`)
 * and switched from the admin panel — no code change or redeploy needed.
 * There is NO automatic fallback: exactly one provider handles new payments;
 * switching back to Xendit is a manual admin action.
 */

import type { Env } from "../../types";
import { createPaymentProvider as createXenditProvider, useRealPayments } from "./xendit-client";
import { createSingaPayProvider, useRealSingaPay } from "./singapay-client";
import type { PaymentProviderClient } from "./xendit-client";
import type { PaymentProvider as PaymentProviderType } from "../../domain/payment/types";

export type PaymentProviderId = "singapay" | "xendit";

/** Registered provider ids (order = display order in the admin UI). */
export const PAYMENT_PROVIDER_IDS = ["singapay", "xendit"] as const;

/** Default active provider — SingaPay is primary. */
export const DEFAULT_PAYMENT_PROVIDER: PaymentProviderId = "singapay";

export function isPaymentProviderId(value: string): value is PaymentProviderId {
  return value === "singapay" || value === "xendit";
}

/** Resolve the active provider from app settings (admin switch). */
export async function resolveActivePaymentProvider(
  getSetting: (key: string) => Promise<string | null>,
): Promise<PaymentProviderId> {
  const value = (await getSetting("payment_provider")) ?? "";
  return isPaymentProviderId(value) ? value : DEFAULT_PAYMENT_PROVIDER;
}

/** Client for a provider: Xendit → existing client; SingaPay → payment links. */
export function createProviderClient(env: Env, provider: PaymentProviderType): PaymentProviderClient {
  switch (provider) {
    case "xendit":
      return createXenditProvider(env);
    case "singapay":
      return createSingaPayProvider(env);
  }
}

/** Whether the provider is in REAL mode (no mock invoices for billing flows). */
export function providerIsReal(env: Env, provider: PaymentProviderType): boolean {
  return provider === "xendit" ? useRealPayments(env) : useRealSingaPay(env);
}
