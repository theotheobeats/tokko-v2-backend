/**
 * Payment bounded context — domain types and value objects.
 *
 * A Payment wraps a payment attempt for an Order via a payment provider
 * (Xendit). One order can have several payment attempts (expired/failed →
 * create a new one); the most recent successful one confirms the order.
 */

export const PaymentStatus = {
  Pending: "pending",
  Paid: "paid",
  Failed: "failed",
  Expired: "expired",
} as const;
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

export const PaymentProvider = {
  Xendit: "xendit",
  SingaPay: "singapay",
} as const;
export type PaymentProvider = (typeof PaymentProvider)[keyof typeof PaymentProvider];

/** Xendit payment channels we expose (maps to Xendit invoice payment methods). */
export const PaymentChannel = {
  Qris: "qris",
  BankTransfer: "bank_transfer",
  Ewallet: "ewallet",
  CreditCard: "credit_card",
} as const;
export type PaymentChannel = (typeof PaymentChannel)[keyof typeof PaymentChannel];

/** Valid payment status transitions. */
export const VALID_PAYMENT_TRANSITIONS: Record<PaymentStatus, PaymentStatus[]> = {
  pending: ["paid", "failed", "expired"],
  paid: [], // terminal
  failed: [], // terminal — create a new payment attempt instead
  // A payment that arrived AFTER the invoice expired still counts — the
  // customer did pay. Xendit sends a PAID event for it ("payment received
  // after expiry"), so expired → paid must not throw.
  expired: ["paid"],
};

/** Human label for a channel (used by the UI). */
export const CHANNEL_LABEL: Record<PaymentChannel, string> = {
  qris: "QRIS",
  bank_transfer: "Transfer Bank (VA)",
  ewallet: "E-Wallet",
  credit_card: "Kartu Kredit/Debit",
};
