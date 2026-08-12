import { describe, it, expect, vi } from "vitest";
import {
  resolveActivePaymentProvider,
  createProviderClient,
  isPaymentProviderId,
  DEFAULT_PAYMENT_PROVIDER,
} from "../../../src/infrastructure/payments/registry";
import { CreatePayment } from "../../../src/application/payment/payment-use-cases";
import { Order } from "../../../src/domain/order/order";
import { Payment } from "../../../src/domain/payment/payment";
import { createEntityId } from "../../../src/domain/shared/types";
import type { PaymentRepository } from "../../../src/infrastructure/repos/d1-payment-repo";
import type { OrderRepository } from "../../../src/infrastructure/repos/d1-order-repo";
import type { PaymentProviderClient } from "../../../src/infrastructure/payments/xendit-client";

const devEnv = { NODE_ENV: "development" } as never;

// ---------------------------------------------------------------------------
// resolveActivePaymentProvider
// ---------------------------------------------------------------------------

describe("resolveActivePaymentProvider", () => {
  it("defaults to singapay when nothing is stored", async () => {
    const provider = await resolveActivePaymentProvider(async () => null);
    expect(provider).toBe(DEFAULT_PAYMENT_PROVIDER);
    expect(provider).toBe("singapay");
  });

  it("returns the stored provider", async () => {
    expect(await resolveActivePaymentProvider(async () => "singapay")).toBe("singapay");
    expect(await resolveActivePaymentProvider(async () => "xendit")).toBe("xendit");
  });

  it("falls back to the default on unknown values", async () => {
    expect(await resolveActivePaymentProvider(async () => "midtrans")).toBe(DEFAULT_PAYMENT_PROVIDER);
    expect(await resolveActivePaymentProvider(async () => "")).toBe(DEFAULT_PAYMENT_PROVIDER);
  });
});

describe("isPaymentProviderId", () => {
  it("accepts only registered ids", () => {
    expect(isPaymentProviderId("singapay")).toBe(true);
    expect(isPaymentProviderId("xendit")).toBe(true);
    expect(isPaymentProviderId("midtrans")).toBe(false);
    expect(isPaymentProviderId("")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// createProviderClient
// ---------------------------------------------------------------------------

describe("createProviderClient", () => {
  it("routes xendit to the existing client (mock in dev without a key)", () => {
    const client = createProviderClient(devEnv, "xendit");
    expect(client).toBeDefined();
    expect(typeof client.createInvoice).toBe("function");
    expect(typeof client.getInvoice).toBe("function");
  });

  it("routes singapay to the SingaPay client (mock in dev without keys)", () => {
    const client = createProviderClient(devEnv, "singapay");
    expect(client).toBeDefined();
    expect(typeof client.createInvoice).toBe("function");
    expect(typeof client.getInvoice).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// CreatePayment records the active provider on the payment row
// ---------------------------------------------------------------------------

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

function mockPaymentRepo(): PaymentRepository {
  return {
    findById: vi.fn().mockResolvedValue(null),
    findByExternalId: vi.fn().mockResolvedValue(null),
    findByOrderId: vi.fn().mockResolvedValue([]),
    listByStoreId: vi.fn().mockResolvedValue({ payments: [], total: 0 }),
    save: vi.fn().mockResolvedValue(undefined),
  };
}

function mockOrderRepo(): OrderRepository {
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
  };
}

function mockProvider(): PaymentProviderClient {
  return {
    createInvoice: vi.fn().mockResolvedValue({
      externalId: "tokko-test-1",
      invoiceUrl: "https://checkout.payments.test/web/tokko-test-1",
    }),
    getInvoice: vi.fn().mockResolvedValue({ status: "PENDING" }),
  };
}

describe("CreatePayment records the provider", () => {
  it("stores the registry-resolved provider on the payment", async () => {
    const order = makeOrder();
    const paymentRepo = mockPaymentRepo();
    let saved: Payment | undefined;
    paymentRepo.save.mockImplementation(async (p) => {
      saved = p;
    });
    const orderRepo = mockOrderRepo();
    orderRepo.findById.mockResolvedValue(order);

    const useCase = new CreatePayment(orderRepo, paymentRepo, mockProvider());
    const result = await useCase.execute({ orderId: order.id, provider: "singapay" });

    expect(result.ok).toBe(true);
    expect(saved).toBeDefined();
    expect(saved!.toJSON().provider).toBe("singapay");
  });

  it("defaults to xendit when no provider is passed", async () => {
    const order = makeOrder();
    const paymentRepo = mockPaymentRepo();
    let saved: Payment | undefined;
    paymentRepo.save.mockImplementation(async (p) => {
      saved = p;
    });
    const orderRepo = mockOrderRepo();
    orderRepo.findById.mockResolvedValue(order);

    const useCase = new CreatePayment(orderRepo, paymentRepo, mockProvider());
    const result = await useCase.execute({ orderId: order.id });

    expect(result.ok).toBe(true);
    expect(saved!.toJSON().provider).toBe("xendit");
  });
});
