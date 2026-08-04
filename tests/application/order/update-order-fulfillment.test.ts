import { describe, it, expect, vi, beforeEach } from "vitest";
import { UpdateOrderFulfillment } from "../../../src/application/order/update-order-fulfillment";
import type { OrderRepository } from "../../../src/infrastructure/repos/d1-order-repo";
import { Order } from "../../../src/domain/order/order";
import { createEntityId } from "../../../src/domain/shared/types";

function mockOrderRepo(overrides?: Partial<OrderRepository>): OrderRepository {
  return {
    findById: vi.fn().mockResolvedValue(null),
    findByStoreId: vi.fn().mockResolvedValue([]),
    countByStoreId: vi.fn().mockResolvedValue({ all: 0, pending: 0, contacted: 0, completed: 0 }),
    save: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

const storeId = createEntityId();

function makeOrder(type: "product" | "service" | "booking" = "booking") {
  const items: Record<string, { productId: ReturnType<typeof createEntityId>; productName: string; quantity: number; unitPrice: number; productType: "product" | "service" | "booking" }> = {
    product: { productId: createEntityId(), productName: "Cake", quantity: 1, unitPrice: 85000, productType: "product" },
    service: { productId: createEntityId(), productName: "Potong Rambut", quantity: 1, unitPrice: 50000, productType: "service" },
    booking: { productId: createEntityId(), productName: "Konsultasi", quantity: 1, unitPrice: 0, productType: "booking" },
  };
  return Order.create({
    storeId,
    customerName: "Rina",
    customerPhone: "+62",
    items: [items[type]],
    ...(type === "product" ? { shippingAddress: "Jl. Test No. 1" } : {}),
  });
}

describe("UpdateOrderFulfillment use case", () => {
  let repo: OrderRepository;
  let useCase: UpdateOrderFulfillment;

  beforeEach(() => {
    repo = mockOrderRepo();
    useCase = new UpdateOrderFulfillment(repo);
  });

  it("should set tracking number and courier for a product order", async () => {
    const order = makeOrder("product");
    (repo.findById as any).mockResolvedValue(order);

    const result = await useCase.execute({
      orderId: order.id,
      trackingNumber: "JNE123456",
      courier: "JNE",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.trackingNumber).toBe("JNE123456");
      expect(result.value.courier).toBe("JNE");
      expect(result.value.isFulfillmentComplete ?? true).toBe(true);
    }
    expect(repo.save).toHaveBeenCalledOnce();
  });

  it("should confirm payment for a service order", async () => {
    const order = makeOrder("service");
    (repo.findById as any).mockResolvedValue(order);

    const result = await useCase.execute({
      orderId: order.id,
      paymentConfirmed: true,
      paymentNote: "BCA a.n. Anna",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.paymentConfirmed).toBe(true);
      expect(result.value.paymentNote).toBe("BCA a.n. Anna");
    }
  });

  it("should set queue number for a booking order", async () => {
    const order = makeOrder("booking");
    (repo.findById as any).mockResolvedValue(order);

    const result = await useCase.execute({
      orderId: order.id,
      queueNumber: "A-001",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.queueNumber).toBe("A-001");
    }
  });

  it("should reject an empty tracking number", async () => {
    const order = makeOrder("product");
    (repo.findById as any).mockResolvedValue(order);

    const result = await useCase.execute({
      orderId: order.id,
      trackingNumber: "   ",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VALIDATION");
      expect(result.error.field).toBe("trackingNumber");
    }
    expect(repo.save).not.toHaveBeenCalled();
  });

  it("should reject an empty queue number", async () => {
    const order = makeOrder("booking");
    (repo.findById as any).mockResolvedValue(order);

    const result = await useCase.execute({
      orderId: order.id,
      queueNumber: "",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION");
  });

  it("should return error when order not found", async () => {
    const result = await useCase.execute({
      orderId: createEntityId(),
      queueNumber: "A-001",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NOT_FOUND");
    expect(repo.save).not.toHaveBeenCalled();
  });

  it("should allow partial updates without touching other fields", async () => {
    const order = makeOrder("product");
    order.updateFulfillment({ trackingNumber: "JNE123", courier: "JNE" });
    (repo.findById as any).mockResolvedValue(order);

    const result = await useCase.execute({
      orderId: order.id,
      paymentConfirmed: true, // unrelated field for a product order — must not clear the resi
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.trackingNumber).toBe("JNE123");
      expect(result.value.paymentConfirmed).toBe(true);
    }
  });
});
