/**
 * Payment aggregate root — a payment attempt for an Order via a provider.
 */

import type { EntityId } from "../shared/types";
import { createEntityId } from "../shared/types";
import {
  PaymentStatus,
  PaymentProvider,
  VALID_PAYMENT_TRANSITIONS,
  type PaymentStatus as PaymentStatusType,
  type PaymentProvider as PaymentProviderType,
} from "./types";

export interface PaymentProps {
  id: EntityId;
  orderId: EntityId;
  storeId: EntityId;
  amount: number; // integer Rupiah
  currency: string;
  provider: PaymentProviderType;
  /** Payment method the customer picked (qris / bank_transfer / ewallet / credit_card). */
  channel: string | null;
  status: PaymentStatusType;
  /** Provider's invoice id. */
  externalId: string;
  /** Provider-hosted payment page URL. */
  invoiceUrl: string;
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export class Payment {
  private constructor(private readonly props: PaymentProps) {}

  static create(params: {
    orderId: EntityId;
    storeId: EntityId;
    amount: number;
    currency?: string;
    provider?: PaymentProviderType;
    channel?: string | null;
    externalId: string;
    invoiceUrl: string;
  }): Payment {
    if (!Number.isFinite(params.amount) || params.amount <= 0) {
      throw new Error("Amount must be a positive number");
    }
    if (!params.externalId.trim()) throw new Error("External id is required");
    if (!params.invoiceUrl.trim()) throw new Error("Invoice url is required");

    const now = new Date().toISOString();
    return new Payment({
      id: createEntityId(),
      orderId: params.orderId,
      storeId: params.storeId,
      amount: Math.round(params.amount),
      currency: params.currency ?? "IDR",
      provider: params.provider ?? PaymentProvider.Hosted,
      channel: params.channel?.trim() || null,
      status: PaymentStatus.Pending,
      externalId: params.externalId.trim(),
      invoiceUrl: params.invoiceUrl.trim(),
      paidAt: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  static from(props: PaymentProps): Payment {
    return new Payment(props);
  }

  // Getters
  get id() { return this.props.id; }
  get orderId() { return this.props.orderId; }
  get storeId() { return this.props.storeId; }
  get amount() { return this.props.amount; }
  get currency() { return this.props.currency; }
  get provider() { return this.props.provider; }
  get channel() { return this.props.channel; }
  get status() { return this.props.status; }
  get externalId() { return this.props.externalId; }
  get invoiceUrl() { return this.props.invoiceUrl; }
  get paidAt() { return this.props.paidAt; }
  get createdAt() { return this.props.createdAt; }
  get updatedAt() { return this.props.updatedAt; }

  get isPaid(): boolean {
    return this.props.status === PaymentStatus.Paid;
  }

  /** Transition to a new status (validated). */
  private transition(next: PaymentStatusType, extra?: Partial<PaymentProps>): void {
    if (next === this.props.status) return;
    const allowed = VALID_PAYMENT_TRANSITIONS[this.props.status];
    if (!allowed.includes(next)) {
      throw new Error(`Invalid payment transition: ${this.props.status} → ${next}`);
    }
    this.props.status = next;
    this.props.updatedAt = new Date().toISOString();
    if (extra) Object.assign(this.props, extra);
  }

  /** Mark paid (webhook: invoice.paid). */
  markPaid(paidAt?: string): Payment {
    this.transition(PaymentStatus.Paid, { paidAt: paidAt ?? new Date().toISOString() });
    return this;
  }

  /** Mark failed (webhook: invoice.failed). */
  markFailed(): Payment {
    this.transition(PaymentStatus.Failed);
    return this;
  }

  /** Mark expired (webhook: invoice.expired). */
  markExpired(): Payment {
    this.transition(PaymentStatus.Expired);
    return this;
  }

  toJSON(): PaymentProps {
    return { ...this.props };
  }
}
