import { describe, it, expect, vi, beforeEach } from "vitest";
import { SubmitOrder } from "../../../src/application/order/submit-order";
import type { OrderRepository } from "../../../src/infrastructure/repos/d1-order-repo";
import type { ProductRepository } from "../../../src/infrastructure/repos/d1-product-repo";
import { Product } from "../../../src/domain/store/product";
import { ProductVariant } from "../../../src/domain/store/variant";
import { createEntityId } from "../../../src/domain/shared/types";

const storeId = createEntityId();

function makeProduct(name: string, price: number, type: "product" | "service" | "booking" = "product") {
  return Product.create({ storeId, name, price, type });
}

function makeVariant(productId: string, name: string, price: number | null) {
  return ProductVariant.create({ productId: productId as any, name, price });
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

describe("SubmitOrder with variants", () => {
  let orderRepo: OrderRepository;
  let productRepo: ProductRepository;
  let useCase: SubmitOrder;

  beforeEach(() => {
    orderRepo = mockOrderRepo();
    productRepo = mockProductRepo();
    useCase = new SubmitOrder(orderRepo, productRepo);
  });

  it("snapshots the variant price and name when a variant is chosen", async () => {
    const product = makeProduct("Selimut", 100000);
    const variant = makeVariant(product.id, "Ukuran S", 90000);
    (productRepo.findById as any).mockResolvedValue(product);
    (productRepo.findVariantsByProductIds as any).mockResolvedValue([variant]);

    const result = await useCase.execute({
      storeId,
      customerName: "Budi",
      customerPhone: "0812345",
      items: [{ productId: product.id, variantId: variant.id, quantity: 2 }],
      shippingAddress: "Jakarta",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const item = result.value.items[0];
      expect(item.unitPrice).toBe(90000);
      expect(item.variantName).toBe("Ukuran S");
      expect(item.unitPrice * item.quantity).toBe(180000);
    }
  });

  it("uses the product effective price when the variant inherits (price null)", async () => {
    const product = makeProduct("Selimut", 100000);
    const variant = makeVariant(product.id, "Ukuran M", null);
    (productRepo.findById as any).mockResolvedValue(product);
    (productRepo.findVariantsByProductIds as any).mockResolvedValue([variant]);

    const result = await useCase.execute({
      storeId,
      customerName: "Budi",
      customerPhone: "0812345",
      items: [{ productId: product.id, variantId: variant.id, quantity: 1 }],
      shippingAddress: "Jakarta",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.items[0].unitPrice).toBe(100000);
    }
  });

  it("uses sale price when a product is on sale", async () => {
    const product = Product.create({ storeId, name: "Promo", price: 100000, salePrice: 80000 });
    (productRepo.findById as any).mockResolvedValue(product);

    const result = await useCase.execute({
      storeId,
      customerName: "Budi",
      customerPhone: "0812345",
      items: [{ productId: product.id, quantity: 1 }],
      shippingAddress: "Jakarta",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.items[0].unitPrice).toBe(80000);
    }
  });

  it("rejects a variant that does not belong to the product", async () => {
    const product = makeProduct("Selimut", 100000);
    const foreignVariant = makeVariant(createEntityId(), "Varian Lain", 5000);
    (productRepo.findById as any).mockResolvedValue(product);
    (productRepo.findVariantsByProductIds as any).mockResolvedValue([foreignVariant]);

    const result = await useCase.execute({
      storeId,
      customerName: "Budi",
      customerPhone: "0812345",
      items: [{ productId: product.id, variantId: foreignVariant.id, quantity: 1 }],
      shippingAddress: "Jakarta",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VARIANT_NOT_FOUND");
  });

  it("still requires a shipping address for physical products", async () => {
    const product = makeProduct("Kue", 50000);
    (productRepo.findById as any).mockResolvedValue(product);

    const result = await useCase.execute({
      storeId,
      customerName: "Budi",
      customerPhone: "0812345",
      items: [{ productId: product.id, quantity: 1 }],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION");
  });
});
