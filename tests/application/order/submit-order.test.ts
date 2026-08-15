import { describe, it, expect, vi, beforeEach } from "vitest";
import { SubmitOrder } from "../../../src/application/order/submit-order";
import type { OrderRepository } from "../../../src/infrastructure/repos/d1-order-repo";
import type { ProductRepository } from "../../../src/infrastructure/repos/d1-product-repo";
import { Product } from "../../../src/domain/store/product";
import { ProductVariant } from "../../../src/domain/store/variant";
import { Store } from "../../../src/domain/store/store";
import { BusinessType, Aesthetic } from "../../../src/domain/store/types";
import type { StoreRepository } from "../../../src/application/store/store-repo";
import type { ShippingProviderClient } from "../../../src/infrastructure/shipping/biteship-client";
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

describe("SubmitOrder with shipping", () => {
  /** Store with a complete shipping origin (Biteship rates need all fields). */
  function makeStoreWithOrigin(): Store {
    const store = Store.create({
      ownerId: createEntityId(),
      name: "Test Store",
      businessType: BusinessType.Food,
      aestheticPreference: Aesthetic.Warm,
      whatsappNumber: "+62",
    });
    store.updateShippingOrigin({
      originAddress: "Jl. Merdeka No. 1",
      originRt: "001",
      originRw: "002",
      originKelurahan: "Cideng",
      originKecamatan: "Gambir",
      originCity: "Jakarta Pusat",
      originProvince: "DKI Jakarta",
      originPostalCode: "10150",
      originContactName: "Anna",
      originContactPhone: "+6281234567890",
    });
    return store;
  }

  /** Shippable physical product — weight + dimensions required for rates. */
  function makeShippableProduct(name: string, price: number) {
    return Product.create({
      storeId,
      name,
      price,
      weight: 500,
      width: 10,
      length: 10,
      height: 5,
    });
  }

  function mockShippingProvider(rates: unknown[] = [
    { courier: "jne", service: "reg", name: "Reguler", duration: "2 - 3 hari", price: 15000, collectionMethod: ["pickup"] },
  ]): ShippingProviderClient {
    return {
      getRates: vi.fn().mockResolvedValue(rates),
      resolveCoordinates: vi.fn().mockResolvedValue(null),
    };
  }

  it("adds the quoted delivery fee on top of the items total", async () => {
    const store = makeStoreWithOrigin();
    const product = makeShippableProduct("Kue", 25000);
    const orderRepo = mockOrderRepo();
    const productRepo = mockProductRepo({
      findById: vi.fn().mockResolvedValue(product),
      findVariantsByProductIds: vi.fn().mockResolvedValue([]),
    });
    const storeRepo = { findById: vi.fn().mockResolvedValue(store) } as unknown as StoreRepository;
    const provider = mockShippingProvider();
    const useCase = new SubmitOrder(orderRepo, productRepo, storeRepo, provider);

    const result = await useCase.execute({
      storeId,
      customerName: "Budi",
      customerPhone: "0812345",
      items: [{ productId: product.id, quantity: 1 }],
      shippingAddress: "Jl. Tujuan No. 2, Bandung",
      shipping: {
        type: "courier",
        courierCompany: "jne",
        courierType: "reg",
        destinationPostalCode: "40111",
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Delivery fee quoted by the provider lands on the order — on top of items.
      expect(result.value.shippingFee).toBe(15000);
      expect(result.value.shippingCourier).toBe("jne");
      expect(result.value.totalAmount).toBe(40000); // 25000 items + 15000 delivery
    }
  });

  it("maps the payment method onto the order", async () => {
    const product = makeProduct("Kue", 25000);
    const orderRepo = mockOrderRepo();
    const productRepo = mockProductRepo({
      findById: vi.fn().mockResolvedValue(product),
      findVariantsByProductIds: vi.fn().mockResolvedValue([]),
    });
    const useCase = new SubmitOrder(orderRepo, productRepo);

    const result = await useCase.execute({
      storeId,
      customerName: "Budi",
      customerPhone: "0812345",
      items: [{ productId: product.id, quantity: 1 }],
      shippingAddress: "Jakarta",
      paymentMethod: "manual",
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.paymentMethod).toBe("manual");
  });
});

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
