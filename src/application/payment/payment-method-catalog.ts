/**
 * Payment method catalog — the payment options a store can enable, mapped to
 * Xendit invoice `payment_methods` codes.
 *
 * Fee rates are Xendit's PUBLISHED schedule (public pricing page). Xendit
 * does not expose account-specific fee rates via API — those are negotiated
 * per account and shown in the Xendit dashboard — so this catalog is the
 * platform's display source and is easily adjustable.
 */

export interface PaymentMethodInfo {
  /** Stable id persisted on the store (e.g. "bca"). */
  id: string;
  /** Human label shown in settings + checkout. */
  label: string;
  /** Group label for display ("QRIS" | "Virtual Account" | "E-Wallet" | "Kartu"). */
  group: string;
  /** Xendit invoice payment_methods codes for this option. */
  xenditMethods: string[];
  /** Published fee rate, percent of the transaction (e.g. 2.5 = 2.5%). */
  feePercent: number;
  /** Fixed fee in Rupiah (0 when none). */
  feeFixed: number;
}

export const PAYMENT_METHOD_CATALOG: PaymentMethodInfo[] = [
  { id: "qris", label: "QRIS", group: "QRIS", xenditMethods: ["QRIS"], feePercent: 0.7, feeFixed: 0 },
  { id: "bca", label: "BCA", group: "Virtual Account", xenditMethods: ["BANK_BCA"], feePercent: 2.5, feeFixed: 0 },
  { id: "mandiri", label: "Mandiri", group: "Virtual Account", xenditMethods: ["BANK_MANDIRI"], feePercent: 1.5, feeFixed: 0 },
  { id: "bni", label: "BNI", group: "Virtual Account", xenditMethods: ["BANK_BNI"], feePercent: 2.5, feeFixed: 0 },
  { id: "bri", label: "BRI", group: "Virtual Account", xenditMethods: ["BANK_BRI"], feePercent: 2.5, feeFixed: 0 },
  { id: "ovo", label: "OVO", group: "E-Wallet", xenditMethods: ["EWALLET_OVO"], feePercent: 1.9, feeFixed: 0 },
  { id: "gopay", label: "GoPay", group: "E-Wallet", xenditMethods: ["EWALLET_GOPAY"], feePercent: 1.9, feeFixed: 0 },
  { id: "dana", label: "DANA", group: "E-Wallet", xenditMethods: ["EWALLET_DANA"], feePercent: 1.9, feeFixed: 0 },
  { id: "shopeepay", label: "ShopeePay", group: "E-Wallet", xenditMethods: ["EWALLET_SHOPEEPAY"], feePercent: 1.9, feeFixed: 0 },
  { id: "credit_card", label: "Kartu Kredit/Debit", group: "Kartu", xenditMethods: ["CREDIT_CARD"], feePercent: 2.9, feeFixed: 2000 },
];

export const DEFAULT_ENABLED_PAYMENT_METHODS: string[] = PAYMENT_METHOD_CATALOG.map((m) => m.id);

export function isPaymentMethodId(id: string): boolean {
  return PAYMENT_METHOD_CATALOG.some((m) => m.id === id);
}

/** Xendit `payment_methods` codes for a set of catalog ids (unknown ids dropped). */
export function xenditMethodsFor(ids: string[]): string[] {
  return PAYMENT_METHOD_CATALOG.filter((m) => ids.includes(m.id)).flatMap((m) => m.xenditMethods);
}
