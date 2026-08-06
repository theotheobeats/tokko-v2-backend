import { describe, it, expect, vi } from "vitest";
import {
  CreatePayment,
  HandleXenditWebhook,
  OrderNotFoundError,
  OrderAlreadyPaidError,
  PaymentNotFoundError,
  WebhookAmountMismatchError,
  type XenditWebhookPayload,
} from "../../../src/application/payment/payment-use-cases";
import type { PaymentRepository } from "../../../src/infrastructure/repos/d1-payment-repo";
import type { OrderRepository } from "../../../src/infrastructure/repos/d1-order-repo";
import type { PaymentProviderClient } from "../../../src/infrastructure/payments/xendit-client";
import { Order } from "../../../src/domain/order/order";
import { createEntityId } from "../../../src/domain/shared/types";

const storeId = createEntityId();

function makeOrder() {
  return Order.create({
    storeId,
    customerName: "Rina",
    customerPhone: "+628111222333",
    items: [
      { productId: createEntityId(), productName: "Cake", quantity: 1, unitPrice: 85000, productType: "product" },
    ],
    shippingAddress: "Jl. Test 1",
  });
}

function mockPaymentRepo(overrides?: Partial<PaymentRepository>): PaymentRepository {
  return {
    findById: vi.fn().mockResolvedValue(null),
    findByExternalId: vi.fn().mockResolvedValue(null),
    findByOrderId: vi.fn().mockResolvedValue([]),
    listByStoreId: vi.fn().mockResolvedValue({ payments: [], total: 0 }),
    save: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function mockOrderRepo(overrides?: Partial<OrderRepository>): OrderRepository {
  return {
    findById: vi.fn().mockResolvedValue(null),
    findByStoreId: vi.fn().mockResolvedValue([]),
    countByStoreId: vi.fn().mockResolvedValue({ all: 0, pending: 0, contacted: 0, completed: 0 }),
    save: vi.fn().mockResolvedValue(undefined),
    listAll: vi.fn().mockResolvedValue([]),
    countAll: vi.fn().mockResolvedValue({ all: 0, pending: 0, contacted: 0, completed: 0 }),
    sumTotalAll: vi.fn().mockResolvedValue(0),
    since: vi.fn().mockResolvedValue({ orders: 0, gmv: 0 }),
    deleteByStoreId: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function mockProvider(overrides?: Partial<PaymentProviderClient>): PaymentProviderClient {
  return {
    createInvoice: vi.fn().mockResolvedValue({
      externalId: "xnd-invoice-1",
      invoiceUrl: "https://checkout.xendit.co/web/1",
    }),
    getInvoice: vi.fn().mockResolvedValue({ status: "PENDING" }),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// CreatePayment
// ---------------------------------------------------------------------------

describe("CreatePayment", () => {
  it("should create a payment via the provider and persist it", async () => {
    const order = makeOrder();
    const paymentRepo = mockPaymentRepo();
    const provider = mockProvider();

    const result = await new CreatePayment(
      mockOrderRepo({ findById: vi.fn().mockResolvedValue(order) }),
      paymentRepo,
      provider,
    ).execute({ orderId: order.id, channel: "qris" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.amount).toBe(order.totalAmount);
      expect(result.value.channel).toBe("qris");
      expect(result.value.externalId).toBe("xnd-invoice-1");
      expect(result.value.status).toBe("pending");
    }
    expect(provider.createInvoice).toHaveBeenCalledWith(
      expect.objectContaining({ amount: order.totalAmount, description: `Pesanan ${order.orderCode}` }),
    );
    expect(paymentRepo.save).toHaveBeenCalledTimes(1);
  });

  it("should return not-found for unknown orders", async () => {
    const result = await new CreatePayment(mockOrderRepo(), mockPaymentRepo(), mockProvider()).execute({
      orderId: createEntityId(),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(OrderNotFoundError);
  });

  it("should reject creating a payment for an already-paid order", async () => {
    const order = makeOrder();
    order.updateFulfillment({ paymentConfirmed: true });

    const result = await new CreatePayment(
      mockOrderRepo({ findById: vi.fn().mockResolvedValue(order) }),
      mockPaymentRepo(),
      mockProvider(),
    ).execute({ orderId: order.id });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(OrderAlreadyPaidError);
  });

  it("should surface provider errors", async () => {
    const order = makeOrder();
    const provider = mockProvider({
      createInvoice: vi.fn().mockRejectedValue(new Error("Xendit 500: boom")),
    });

    const result = await new CreatePayment(
      mockOrderRepo({ findById: vi.fn().mockResolvedValue(order) }),
      mockPaymentRepo(),
      provider,
    ).execute({ orderId: order.id });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("boom");
  });
});

// ---------------------------------------------------------------------------
// HandleXenditWebhook
// ---------------------------------------------------------------------------

describe("HandleXenditWebhook", () => {
  const paidPayload: XenditWebhookPayload = {
    id: "invoice-1",
    external_id: "xnd-invoice-1",
    status: "PAID",
    paid_at: "2026-08-06T10:00:00Z",
    payment_method: "QRIS",
    amount: 85000,
  };

  it("should mark the payment paid and confirm the order", async () => {
    const order = makeOrder();
    const paymentRepo = mockPaymentRepo();
    const orderRepo = mockOrderRepo({ findById: vi.fn().mockResolvedValue(order) });

    // Seed the payment via CreatePayment-like state (mock findByExternalId).
    const created = await new CreatePayment(
      orderRepo,
      paymentRepo,
      mockProvider(),
    ).execute({ orderId: order.id });
    expect(created.ok).toBe(true);
    const payment = (created as { ok: true; value: { externalId: string } }).value;
    // The repo mock doesn't persist — wire findByExternalId to return the domain object.
    const paymentDomain = (
      created as { ok: true; value: import("../../../src/domain/payment/payment").Payment }
    ).value;
    paymentRepo.findByExternalId = vi.fn().mockResolvedValue(paymentDomain);

    const result = await new HandleXenditWebhook(paymentRepo, orderRepo).execute(paidPayload);
    expect(result.ok).toBe(true);
    expect(paymentDomain.status).toBe("paid");
    expect(paymentDomain.paidAt).toBe("2026-08-06T10:00:00Z");
    expect(order.paymentConfirmed).toBe(true);
    void payment;
  });

  it("should be idempotent for already-paid payments", async () => {
    const order = makeOrder();
    const paymentRepo = mockPaymentRepo();
    const orderRepo = mockOrderRepo({ findById: vi.fn().mockResolvedValue(order) });

    const created = await new CreatePayment(orderRepo, paymentRepo, mockProvider()).execute({
      orderId: order.id,
    });
    const paymentDomain = (created as { ok: true; value: import("../../../src/domain/payment/payment").Payment }).value;
    paymentDomain.markPaid(); // simulate prior webhook
    paymentRepo.findByExternalId = vi.fn().mockResolvedValue(paymentDomain);
    const saveSpy = vi.fn();
    paymentRepo.save = saveSpy;

    const result = await new HandleXenditWebhook(paymentRepo, orderRepo).execute(paidPayload);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.handled).toBe(true);
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it("should expire the payment on EXPIRED", async () => {
    const order = makeOrder();
    const paymentRepo = mockPaymentRepo();
    const orderRepo = mockOrderRepo({ findById: vi.fn().mockResolvedValue(order) });

    const created = await new CreatePayment(orderRepo, paymentRepo, mockProvider()).execute({
      orderId: order.id,
    });
    const paymentDomain = (created as { ok: true; value: import("../../../src/domain/payment/payment").Payment }).value;
    paymentRepo.findByExternalId = vi.fn().mockResolvedValue(paymentDomain);

    const result = await new HandleXenditWebhook(paymentRepo, orderRepo).execute({
      ...paidPayload,
      status: "EXPIRED",
    });
    expect(result.ok).toBe(true);
    expect(paymentDomain.status).toBe("expired");
    expect(order.paymentConfirmed).toBe(false);
  });

  it("should reject unknown external ids", async () => {
    const result = await new HandleXenditWebhook(mockPaymentRepo(), mockOrderRepo()).execute(paidPayload);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(PaymentNotFoundError);
  });

  it("should reject amount mismatches", async () => {
    const order = makeOrder();
    const paymentRepo = mockPaymentRepo();
    const orderRepo = mockOrderRepo({ findById: vi.fn().mockResolvedValue(order) });

    const created = await new CreatePayment(orderRepo, paymentRepo, mockProvider()).execute({
      orderId: order.id,
    });
    const paymentDomain = (created as { ok: true; value: import("../../../src/domain/payment/payment").Payment }).value;
    paymentRepo.findByExternalId = vi.fn().mockResolvedValue(paymentDomain);

    const result = await new HandleXenditWebhook(paymentRepo, orderRepo).execute({
      ...paidPayload,
      amount: 1, // forged amount
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(WebhookAmountMismatchError);
  });
});
