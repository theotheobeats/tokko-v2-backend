import { describe, it, expect, vi } from "vitest";
import { SyncPendingPayments } from "../../../src/application/payment/sync-payments";
import type { PaymentRepository } from "../../../src/infrastructure/repos/d1-payment-repo";
import type { OrderRepository } from "../../../src/infrastructure/repos/d1-order-repo";
import type { PaymentProviderClient } from "../../../src/infrastructure/payments/xendit-client";
import type { StoreRepository } from "../../../src/application/store/store-repo";
import { Payment } from "../../../src/domain/payment/payment";
import { PaymentChannel } from "../../../src/domain/payment/types";
import { Order } from "../../../src/domain/order/order";
import { createEntityId } from "../../../src/domain/shared/types";

function makePayment(externalId = "tokko-abc"): Payment {
  return Payment.create({
    orderId: createEntityId(),
    storeId: createEntityId(),
    amount: 50000,
    channel: PaymentChannel.Qris,
    externalId,
    invoiceUrl: "https://checkout.xendit.co/web/x",
  });
}

function makeOrder(orderId: string, storeId: string): Order {
  return Order.from({
    id: orderId as never,
    storeId: storeId as never,
    orderCode: "TK-ABC",
    customerName: "Rina",
    customerPhone: "0812",
    items: [],
    totalAmount: 50000,
    status: "pending",
    notes: null,
    shippingAddress: null,
    trackingNumber: null,
    courier: null,
    paymentConfirmed: false,
    paymentNote: null,
    queueNumber: null,
    createdAt: new Date().toISOString(),
  } as never);
}

// Merchant sub-account resolver — no account by default (tests use undefined accountId).
const storeRepo = {
  findById: vi.fn().mockResolvedValue(null),
} as unknown as StoreRepository;

describe("SyncPendingPayments", () => {
  it("marks a pending payment paid + confirms the order when Xendit says PAID", async () => {
    const payment = makePayment();
    const order = makeOrder(payment.orderId as string, payment.storeId as string);

    const paymentRepo = {
      listPending: vi.fn().mockResolvedValue([payment]),
      save: vi.fn().mockResolvedValue(undefined),
    } as unknown as PaymentRepository;
    const orderRepo = {
      findById: vi.fn().mockResolvedValue(order),
      save: vi.fn().mockResolvedValue(undefined),
    } as unknown as OrderRepository;
    const provider = {
      getInvoice: vi.fn().mockResolvedValue({ status: "PAID", paidAt: "2026-08-11T00:00:00Z", paymentMethod: "QRIS" }),
    } as unknown as PaymentProviderClient;

    const result = await new SyncPendingPayments(paymentRepo, orderRepo, () => provider, storeRepo).execute();

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ checked: 1, updated: 1, paid: 1 });
    expect(payment.status).toBe("paid");
    expect(order.paymentConfirmed).toBe(true);
    expect(order.paymentNote).toContain("QRIS");
  });

  it("leaves pending payments alone when Xendit still says PENDING", async () => {
    const payment = makePayment();
    const paymentRepo = {
      listPending: vi.fn().mockResolvedValue([payment]),
      save: vi.fn().mockResolvedValue(undefined),
    } as unknown as PaymentRepository;
    const orderRepo = {} as unknown as OrderRepository;
    const provider = {
      getInvoice: vi.fn().mockResolvedValue({ status: "PENDING" }),
    } as unknown as PaymentProviderClient;

    const result = await new SyncPendingPayments(paymentRepo, orderRepo, () => provider, storeRepo).execute();

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ checked: 1, updated: 0, paid: 0 });
    expect(payment.status).toBe("pending");
    expect(paymentRepo.save).not.toHaveBeenCalled();
  });

  it("marks expired payments and skips provider errors", async () => {
    const expired = makePayment("tokko-expired");
    const errorPayment = makePayment("tokko-error");
    const paymentRepo = {
      listPending: vi.fn().mockResolvedValue([expired, errorPayment]),
      save: vi.fn().mockResolvedValue(undefined),
    } as unknown as PaymentRepository;
    const orderRepo = {} as unknown as OrderRepository;
    const provider = {
      getInvoice: vi
        .fn()
        .mockResolvedValueOnce({ status: "EXPIRED" })
        .mockRejectedValueOnce(new Error("xendit down")),
    } as unknown as PaymentProviderClient;

    const result = await new SyncPendingPayments(paymentRepo, orderRepo, () => provider, storeRepo).execute();

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ checked: 2, updated: 1, paid: 0 });
    expect(expired.status).toBe("expired");
    expect(errorPayment.status).toBe("pending");
  });
});
