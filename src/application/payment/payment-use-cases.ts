/**
 * Payment bounded context — use cases.
 */

import type { EntityId } from "../../domain/shared/types";
import type { Result } from "../../domain/shared/types";
import { ok, err } from "../../domain/shared/types";
import { Payment } from "../../domain/payment/payment";
import type { PaymentStatus } from "../../domain/payment/types";
import type { PaymentRepository } from "../../infrastructure/repos/d1-payment-repo";
import type { OrderRepository } from "../../infrastructure/repos/d1-order-repo";
import type { PaymentProviderClient } from "../../infrastructure/payments/xendit-client";
import { xenditMethodsFor } from "./payment-method-catalog";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class OrderNotFoundError extends Error {
  code = "ORDER_NOT_FOUND";
  constructor() {
    super("Pesanan tidak ditemukan");
  }
}

export class OrderAlreadyPaidError extends Error {
  code = "ORDER_ALREADY_PAID";
  constructor() {
    super("Pesanan ini sudah dibayar");
  }
}

export class PaymentProviderError extends Error {
  code = "PAYMENT_PROVIDER_ERROR";
  constructor(message: string) {
    super(message);
  }
}

export class PaymentNotFoundError extends Error {
  code = "PAYMENT_NOT_FOUND";
  constructor() {
    super("Pembayaran tidak ditemukan");
  }
}

export class WebhookUnauthorizedError extends Error {
  code = "WEBHOOK_UNAUTHORIZED";
  constructor() {
    super("Webhook token tidak valid");
  }
}

export class WebhookAmountMismatchError extends Error {
  code = "WEBHOOK_AMOUNT_MISMATCH";
  constructor() {
    super("Jumlah pembayaran tidak cocok");
  }
}

// ---------------------------------------------------------------------------
// Channel → Xendit payment_methods mapping
// ---------------------------------------------------------------------------

const CHANNEL_METHODS: Record<string, string[]> = {
  qris: ["QRIS"],
  bank_transfer: ["BANK_TRANSFER"],
  ewallet: ["EWALLET"],
  credit_card: ["CREDIT_CARD"],
};

// ---------------------------------------------------------------------------
// CreatePayment
// ---------------------------------------------------------------------------

export interface CreatePaymentInput {
  orderId: EntityId;
  channel?: string | null;
  /** Catalog method ids enabled for this store (e.g. ["qris", "bca"]). */
  paymentMethodIds?: string[];
  customerName?: string;
  customerPhone?: string;
  customerEmail?: string;
  successRedirectUrl?: string;
  failureRedirectUrl?: string;
}

export class CreatePayment {
  constructor(
    private readonly orderRepo: OrderRepository,
    private readonly paymentRepo: PaymentRepository,
    private readonly provider: PaymentProviderClient,
  ) {}

  async execute(input: CreatePaymentInput): Promise<Result<Payment, OrderNotFoundError | OrderAlreadyPaidError | PaymentProviderError>> {
    const order = await this.orderRepo.findById(input.orderId);
    if (!order) return err(new OrderNotFoundError());
    if (order.paymentConfirmed) return err(new OrderAlreadyPaidError());

    const externalId = `tokko-${crypto.randomUUID()}`;
    try {
      const invoice = await this.provider.createInvoice({
        externalId,
        amount: order.totalAmount,
        description: `Pesanan ${order.orderCode}`,
        customer: {
          givenNames: input.customerName?.trim() || undefined,
          mobileNumber: input.customerPhone?.trim() || undefined,
          email: input.customerEmail?.trim() || undefined,
        },
        paymentMethods: input.paymentMethodIds?.length
          ? xenditMethodsFor(input.paymentMethodIds)
          : input.channel
            ? CHANNEL_METHODS[input.channel]
            : undefined,
        successRedirectUrl: input.successRedirectUrl,
        failureRedirectUrl: input.failureRedirectUrl,
      });

      const payment = Payment.create({
        orderId: order.id,
        storeId: order.storeId,
        amount: order.totalAmount,
        channel: input.channel ?? null,
        externalId: invoice.externalId,
        invoiceUrl: invoice.invoiceUrl,
      });

      await this.paymentRepo.save(payment);
      return ok(payment);
    } catch (e) {
      return err(new PaymentProviderError(e instanceof Error ? e.message : "Gagal membuat pembayaran"));
    }
  }
}

// ---------------------------------------------------------------------------
// HandleXenditWebhook
// ---------------------------------------------------------------------------

export interface XenditWebhookPayload {
  id?: string;
  external_id: string;
  status: string; // PAID | EXPIRED | FAILED | PENDING
  paid_at?: string | null;
  payment_method?: string | null;
  amount?: number;
}

export class HandleXenditWebhook {
  constructor(
    private readonly paymentRepo: PaymentRepository,
    private readonly orderRepo: OrderRepository,
    /** Commission-path merchants: record an accrual entry when an order is paid. */
    private readonly commission?: {
      storeRepo: import("../store/store-repo").StoreRepository;
      ledger: import("../../infrastructure/repos/d1-commission-ledger").CommissionLedger;
    },
  ) {}

  /**
   * Process a verified Xendit webhook. Idempotent: a payment that is already
   * paid is a no-op (Xendit can redeliver webhooks).
   */
  async execute(payload: XenditWebhookPayload): Promise<Result<{ handled: boolean }, PaymentNotFoundError | WebhookAmountMismatchError>> {
    const payment = await this.paymentRepo.findByExternalId(payload.external_id);
    if (!payment) return err(new PaymentNotFoundError());

    // Amount must match the created payment (webhook forgery guard).
    if (payload.amount !== undefined && Number(payload.amount) !== payment.amount) {
      return err(new WebhookAmountMismatchError());
    }

    if (payment.status === "paid") return ok({ handled: true }); // idempotent

    switch (payload.status) {
      case "PAID":
        payment.markPaid(payload.paid_at ?? undefined);
        break;
      case "EXPIRED":
        payment.markExpired();
        break;
      case "FAILED":
        payment.markFailed();
        break;
      default:
        return ok({ handled: false }); // PENDING or unknown — ignore
    }

    await this.paymentRepo.save(payment);

    // Paid → confirm the order's payment (owner still does WhatsApp fulfillment).
    if (payment.isPaid) {
      const order = await this.orderRepo.findById(payment.orderId);
      if (order && !order.paymentConfirmed) {
        order.updateFulfillment({
          paymentConfirmed: true,
          ...(payload.payment_method
            ? { paymentNote: `Dibayar via ${payload.payment_method}` }
            : {}),
        });
        await this.orderRepo.save(order);
      }

      // Commission path (selective): accrual entry per paid order.
      if (this.commission) {
        try {
          const store = await this.commission.storeRepo.findById(payment.storeId);
          if (store?.commissionRate) {
            const rate = store.commissionRate;
            await this.commission.ledger.record({
              storeId: store.id,
              orderId: order?.id ?? payment.orderId,
              orderAmount: payment.amount,
              rate,
              fee: Math.round((payment.amount * rate) / 100),
            });
          }
        } catch (e) {
          // Ledger failure must not break payment processing.
          console.error("[commission] failed to record entry:", e);
        }
      }
    }

    return ok({ handled: true });
  }
}

// ---------------------------------------------------------------------------
// ListPayments
// ---------------------------------------------------------------------------

export class ListOrderPayments {
  constructor(private readonly paymentRepo: PaymentRepository) {}

  async execute(input: { orderId: EntityId }): Promise<Payment[]> {
    return this.paymentRepo.findByOrderId(input.orderId);
  }
}

export class ListStorePayments {
  constructor(private readonly paymentRepo: PaymentRepository) {}

  async execute(input: { storeId: EntityId; status?: PaymentStatus; limit?: number; offset?: number }) {
    return this.paymentRepo.listByStoreId(input.storeId, {
      status: input.status,
      limit: input.limit,
      offset: input.offset,
    });
  }
}
