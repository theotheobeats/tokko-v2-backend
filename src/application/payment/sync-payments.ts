/**
 * SyncPendingPayments — admin on-demand reconciliation. For every pending
 * payment (optionally scoped to a store/order), asks the provider for the real
 * invoice status and updates the DB + confirms the order when newly paid.
 *
 * This is the manual fallback for the (rare) case where provider webhooks are
 * permanently lost — the same logic the polling endpoint uses lazily.
 */

import type { EntityId } from "../../domain/shared/types";
import type { Result } from "../../domain/shared/types";
import { ok } from "../../domain/shared/types";
import type { PaymentRepository } from "../../infrastructure/repos/d1-payment-repo";
import type { OrderRepository } from "../../infrastructure/repos/d1-order-repo";
import type { PaymentProviderClient } from "../../infrastructure/payments/payment-provider-client";

export interface SyncPaymentsInput {
  storeId?: EntityId;
  orderId?: EntityId;
}

export interface SyncPaymentsResult {
  checked: number;
  updated: number;
  paid: number;
}

export class SyncPendingPayments {
  constructor(
    private readonly paymentRepo: PaymentRepository,
    private readonly orderRepo: OrderRepository,
    private readonly provider: PaymentProviderClient,
  ) {}

  async execute(input: SyncPaymentsInput = {}): Promise<Result<SyncPaymentsResult, never>> {
    const all = await this.paymentRepo.listPending();
    const targets = all.filter(
      (p) =>
        (!input.storeId || p.storeId === input.storeId) &&
        (!input.orderId || p.orderId === input.orderId),
    );

    let updated = 0;
    let paid = 0;
    for (const payment of targets) {
      try {
        const status = await this.provider.getInvoice(payment.externalId);
        if (status.status === "PAID") payment.markPaid(status.paidAt ?? undefined);
        else if (status.status === "EXPIRED") payment.markExpired();
        else if (status.status === "FAILED") payment.markFailed();

        if (payment.status !== "pending") {
          await this.paymentRepo.save(payment);
          updated++;
        }

        if (payment.isPaid) {
          const order = await this.orderRepo.findById(payment.orderId);
          if (order && !order.paymentConfirmed) {
            order.updateFulfillment({
              paymentConfirmed: true,
              ...(status.paymentMethod
                ? { paymentNote: `Dibayar via ${status.paymentMethod}` }
                : {}),
            });
            await this.orderRepo.save(order);
          }
          paid++;
        }
      } catch {
        // provider error for a single payment — skip it, keep the rest
      }
    }

    return ok({ checked: targets.length, updated, paid });
  }
}
