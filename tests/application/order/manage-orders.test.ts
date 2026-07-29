import { describe, it, expect, vi, beforeEach } from "vitest";
import { SubmitOrder } from "../../../src/application/order/submit-order";
import { ListOrders } from "../../../src/application/order/list-orders";
import { UpdateOrderStatus } from "../../../src/application/order/update-order-status";
import type { OrderRepository } from "../../../src/infrastructure/repos/d1-order-repo";
import { Order } from "../../../src/domain/order/order";
import { OrderStatus } from "../../../src/domain/order/types";
import { createEntityId } from "../../../src/domain/shared/types";
import { Product } from "../../../src/domain/store/product";
import type { ProductRepository } from "../../../src/infrastructure/repos/d1-product-repo";

function mockOrderRepo(overrides?: Partial<OrderRepository>): OrderRepository {
  return {
    findById: vi.fn().mockResolvedValue(null),
    findByStoreId: vi.fn().mockResolvedValue([]),
    countByStoreId: vi.fn().mockResolvedValue({ all: 0, pending: 0, contacted: 0, completed: 0 }),
    save: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function mockProductRepo(overrides?: Partial<ProductRepository>): ProductRepository {
  return {
    findById: vi.fn().mockResolvedValue(null),
    findByStoreId: vi.fn().mockResolvedValue([]),
    save: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    countByStoreId: vi.fn().mockResolvedValue(0),
    ...overrides,
  };
}

const storeId = createEntityId();
const product = Product.create({ storeId, name: "Cake", price: 85000 });

// ---------------------------------------------------------------------------
// SubmitOrder
// ---------------------------------------------------------------------------

describe("SubmitOrder use case", () => {
  let orderRepo: OrderRepository;
  let productRepo: ProductRepository;
  let useCase: SubmitOrder;

  beforeEach(() => {
    orderRepo = mockOrderRepo();
    productRepo = mockProductRepo({
      findById: vi.fn().mockResolvedValue(product),
    });
    useCase = new SubmitOrder(orderRepo, productRepo);
  });

  it("should create a pending order", async () => {
    const result = await useCase.execute({
      storeId,
      customerName: "Rina",
      customerPhone: "+628111222333",
      items: [{ productId: product.id, quantity: 2 }],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.customerName).toBe("Rina");
      expect(result.value.status).toBe(OrderStatus.Pending);
      expect(result.value.items).toHaveLength(1);
      expect(result.value.totalAmount).toBe(170000); // 2 * 85000
    }
    expect(orderRepo.save).toHaveBeenCalledOnce();
  });

  it("should reject empty name", async () => {
    const result = await useCase.execute({
      storeId,
      customerName: "",
      customerPhone: "+62",
      items: [{ productId: product.id, quantity: 1 }],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION");
  });

  it("should reject empty phone", async () => {
    const result = await useCase.execute({
      storeId,
      customerName: "Rina",
      customerPhone: "",
      items: [{ productId: product.id, quantity: 1 }],
    });

    expect(result.ok).toBe(false);
  });

  it("should reject empty items", async () => {
    const result = await useCase.execute({
      storeId,
      customerName: "Rina",
      customerPhone: "+62",
      items: [],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION");
  });

  it("should reject when product not found", async () => {
    const noProductRepo = mockProductRepo();
    const uc = new SubmitOrder(orderRepo, noProductRepo);

    const result = await uc.execute({
      storeId,
      customerName: "Rina",
      customerPhone: "+62",
      items: [{ productId: createEntityId(), quantity: 1 }],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("PRODUCT_UNAVAILABLE");
  });

  it("should reject when product not available", async () => {
    const unavailableProduct = Product.from({ ...product.toJSON(), isAvailable: false });
    const unavailableRepo = mockProductRepo({ findById: vi.fn().mockResolvedValue(unavailableProduct) });
    const uc = new SubmitOrder(orderRepo, unavailableRepo);

    const result = await uc.execute({
      storeId,
      customerName: "Rina",
      customerPhone: "+62",
      items: [{ productId: product.id, quantity: 1 }],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("PRODUCT_UNAVAILABLE");
  });

  it("should include notes when provided", async () => {
    const result = await useCase.execute({
      storeId,
      customerName: "Rina",
      customerPhone: "+62",
      items: [{ productId: product.id, quantity: 1 }],
      notes: "Tolong bungkus kado",
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.notes).toBe("Tolong bungkus kado");
  });

  it("should compute total from product prices in DB", async () => {
    const expensiveProduct = Product.create({ storeId, name: "Expensive", price: 500000 });
    const richRepo = mockProductRepo({ findById: vi.fn().mockResolvedValue(expensiveProduct) });
    const uc = new SubmitOrder(orderRepo, richRepo);

    const result = await uc.execute({
      storeId,
      customerName: "Rina",
      customerPhone: "+62",
      items: [{ productId: expensiveProduct.id, quantity: 3 }],
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.totalAmount).toBe(1500000); // 3 * 500000
  });
});

// ---------------------------------------------------------------------------
// ListOrders
// ---------------------------------------------------------------------------

describe("ListOrders use case", () => {
  it("should return empty list with counts", async () => {
    const repo = mockOrderRepo();
    const useCase = new ListOrders(repo);

    const result = await useCase.execute({ storeId: createEntityId() });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.orders).toHaveLength(0);
      expect(result.value.counts.all).toBe(0);
    }
  });

  it("should filter by status", async () => {
    const repo = mockOrderRepo({
      findByStoreId: vi.fn().mockResolvedValue([]),
    });
    const useCase = new ListOrders(repo);

    await useCase.execute({ storeId: createEntityId(), status: "pending" });

    expect(repo.findByStoreId).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: "pending" })
    );
  });
});

// ---------------------------------------------------------------------------
// UpdateOrderStatus
// ---------------------------------------------------------------------------

describe("UpdateOrderStatus use case", () => {
  let repo: OrderRepository;
  let useCase: UpdateOrderStatus;

  beforeEach(() => {
    repo = mockOrderRepo();
    useCase = new UpdateOrderStatus(repo);
  });

  it("should advance from pending to contacted", async () => {
    const order = Order.create({
      storeId,
      customerName: "Rina",
      customerPhone: "+62",
      items: [{ productId: product.id, productName: "Cake", quantity: 1, unitPrice: 85000 }],
    });
    (repo.findById as any).mockResolvedValue(order);

    const result = await useCase.execute({
      orderId: order.id,
      status: "contacted",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("contacted");
    }
    expect(repo.save).toHaveBeenCalledOnce();
  });

  it("should reject invalid status transition", async () => {
    const order = Order.create({
      storeId,
      customerName: "Rina",
      customerPhone: "+62",
      items: [{ productId: product.id, productName: "Cake", quantity: 1, unitPrice: 85000 }],
    });
    // Order is pending — can't jump to completed
    (repo.findById as any).mockResolvedValue(order);

    const result = await useCase.execute({
      orderId: order.id,
      status: "completed",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INVALID_STATUS_TRANSITION");
    }
    expect(repo.save).not.toHaveBeenCalled();
  });

  it("should return error when order not found", async () => {
    const result = await useCase.execute({
      orderId: createEntityId(),
      status: "contacted",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NOT_FOUND");
  });
});
