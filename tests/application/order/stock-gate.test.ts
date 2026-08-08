import { describe, it, expect, vi, beforeEach } from "vitest";
import { SubmitOrder } from "../../../src/application/order/submit-order";
import type { OrderRepository } from "../../../src/infrastructure/repos/d1-order-repo";
import type { ProductRepository } from "../../../src/infrastructure/repos/d1-product-repo";
import { Product } from "../../../src/domain/store/product";
import { createEntityId } from "../../../src/domain/shared/types";

const storeId = createEntityId();

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

function mockProductRepo(overrides?: Partial<ProductRepository>): ProductRepository {
  return {
    findById: vi.fn().mockResolvedValue(null),
    findByStoreId: vi.fn().mockResolvedValue([]),
    findByStoreSlug: vi.fn().mockResolvedValue(null),
    findVariantsByProductIds: vi.fn().mockResolvedValue([]),
    replaceVariants: vi.fn().mockResolvedValue(undefined),
    deleteVariantsByProductId: vi.fn().mockResolvedValue(undefined),
    save: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    deleteByStoreId: vi.fn().mockResolvedValue(undefined),
    countByStoreId: vi.fn().mockResolvedValue(0),
    ...overrides,
  };
}

describe("Product stock domain", () => {
  it("defaults to unlimited (null) stock", () => {
    const p = Product.create({ storeId, name: "X", price: 1000 });
    expect(p.stock).toBeNull();
    expect(p.isOutOfStock).toBe(false);
  });

  it("tracks stock and flags sold out at 0", () => {
    const p = Product.create({ storeId, name: "X", price: 1000, stock: 3 });
    expect(p.stock).toBe(3);
    expect(p.isOutOfStock).toBe(false);
    const empty = Product.create({ storeId, name: "Y", price: 1000, stock: 0 });
    expect(empty.isOutOfStock).toBe(true);
  });

  it("rejects negative stock", () => {
    expect(() => Product.create({ storeId, name: "X", price: 1000, stock: -1 })).toThrow();
  });

  it("reserveStock decrements and throws when insufficient", () => {
    const p = Product.create({ storeId, name: "X", price: 1000, stock: 2 });
    p.reserveStock(1);
    expect(p.stock).toBe(1);
    p.reserveStock(1);
    expect(p.stock).toBe(0);
    expect(p.isOutOfStock).toBe(true);
    expect(() => p.reserveStock(1)).toThrow();
  });

  it("reserveStock is a no-op for unlimited stock", () => {
    const p = Product.create({ storeId, name: "X", price: 1000 });
    p.reserveStock(5);
    expect(p.stock).toBeNull();
  });
});

describe("SubmitOrder stock gate", () => {
  let orderRepo: OrderRepository;
  let productRepo: ProductRepository;
  let useCase: SubmitOrder;

  beforeEach(() => {
    orderRepo = mockOrderRepo();
    productRepo = mockProductRepo();
    useCase = new SubmitOrder(orderRepo, productRepo);
  });

  it("rejects when quantity exceeds stock", async () => {
    const product = Product.create({ storeId, name: "Selimut", price: 100000, stock: 2 });
    (productRepo.findById as any).mockResolvedValue(product);

    const result = await useCase.execute({
      storeId,
      customerName: "Budi",
      customerPhone: "0812",
      items: [{ productId: product.id, quantity: 3 }],
      shippingAddress: "Jakarta",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("STOCK_INSUFFICIENT");
    expect(orderRepo.save).not.toHaveBeenCalled();
  });

  it("reserves stock and persists the decremented product", async () => {
    const product = Product.create({ storeId, name: "Selimut", price: 100000, stock: 5 });
    (productRepo.findById as any).mockResolvedValue(product);

    const result = await useCase.execute({
      storeId,
      customerName: "Budi",
      customerPhone: "0812",
      items: [{ productId: product.id, quantity: 2 }],
      shippingAddress: "Jakarta",
    });

    expect(result.ok).toBe(true);
    expect(product.stock).toBe(3); // domain object mutated
    const saved = (productRepo.save as any).mock.calls.map((c: any[]) => c[0]);
    expect(saved).toContain(product);
  });

  it("does not touch unlimited-stock products", async () => {
    const product = Product.create({ storeId, name: "Jasa", price: 50000, type: "service" });
    (productRepo.findById as any).mockResolvedValue(product);

    const result = await useCase.execute({
      storeId,
      customerName: "Budi",
      customerPhone: "0812",
      items: [{ productId: product.id, quantity: 10 }],
    });

    expect(result.ok).toBe(true);
    expect(productRepo.save).not.toHaveBeenCalled();
  });
});
