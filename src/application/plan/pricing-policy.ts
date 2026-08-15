/**
 * Pricing policy — which price set is live.
 *
 * Reads the `pricing_beta` app setting (absent → BETA, the current test
 * pricing). Flipping it to "0" moves the platform to NORMAL prices without a
 * redeploy; invoice-amount verification accepts both sets (see
 * isValidInvoiceAmount) so pre-flip invoices still activate.
 */

export const PRICING_BETA_KEY = "pricing_beta";

export async function isBetaPricing(get: (key: string) => Promise<string | null>): Promise<boolean> {
  const value = await get(PRICING_BETA_KEY);
  return value !== "0"; // absent / "1" / anything else → beta (current behavior)
}
