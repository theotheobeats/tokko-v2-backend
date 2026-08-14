/**
 * Payment method catalog — the payment options a store can enable (display +
 * fee source, provider-agnostic). The id → provider-code translation lives in
 * each provider client (Xendit codes ≠ SingaPay codes).
 *
 * Fee rates are the providers' PUBLISHED schedules (public pricing pages) —
 * this catalog is the platform's display source and is easily adjustable.
 */

export interface PaymentMethodInfo {
  /** Stable id persisted on the store (e.g. "bca"). */
  id: string;
  /** Human label shown in settings + checkout. */
  label: string;
  /** Group label for display ("QRIS" | "Virtual Account" | "E-Wallet" | "Kartu"). */
  group: string;
  /** Published fee rate, percent of the transaction (e.g. 2.5 = 2.5%). */
  feePercent: number;
  /** Fixed fee in Rupiah (0 when none). */
  feeFixed: number;
}

export const PAYMENT_METHOD_CATALOG: PaymentMethodInfo[] = [
  { id: "qris", label: "QRIS", group: "QRIS", feePercent: 0.7, feeFixed: 0 },
  { id: "bca", label: "BCA", group: "Virtual Account", feePercent: 2.5, feeFixed: 0 },
  { id: "mandiri", label: "Mandiri", group: "Virtual Account", feePercent: 1.5, feeFixed: 0 },
  { id: "bni", label: "BNI", group: "Virtual Account", feePercent: 2.5, feeFixed: 0 },
  { id: "bri", label: "BRI", group: "Virtual Account", feePercent: 2.5, feeFixed: 0 },
  { id: "ovo", label: "OVO", group: "E-Wallet", feePercent: 1.9, feeFixed: 0 },
  { id: "gopay", label: "GoPay", group: "E-Wallet", feePercent: 1.9, feeFixed: 0 },
  { id: "dana", label: "DANA", group: "E-Wallet", feePercent: 1.9, feeFixed: 0 },
  { id: "shopeepay", label: "ShopeePay", group: "E-Wallet", feePercent: 1.9, feeFixed: 0 },
  { id: "credit_card", label: "Kartu Kredit/Debit", group: "Kartu", feePercent: 2.9, feeFixed: 2000 },
];

export const DEFAULT_ENABLED_PAYMENT_METHODS: string[] = PAYMENT_METHOD_CATALOG.map((m) => m.id);

export function isPaymentMethodId(id: string): boolean {
  return PAYMENT_METHOD_CATALOG.some((m) => m.id === id);
}
