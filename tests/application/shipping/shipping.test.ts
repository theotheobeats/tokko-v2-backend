import { describe, it, expect, vi, beforeEach } from "vitest";
import { GetShippingRates } from "../../../src/application/shipping/get-shipping-rates";
import { SubmitOrder } from "../../../src/application/order/submit-order";
import type { StoreRepository } from "../../../src/application/store/store-repo";
import type { ProductRepository } from "../../../src/infrastructure/repos/d1-product-repo";
import type { OrderRepository } from "../../../src/infrastructure/repos/d1-order-repo";
import type { ShippingProviderClient } from "../../../src/infrastructure/shipping/biteship-client";
import { Store } from "../../../src/domain/store/store";
import { Product } from "../../../src/domain/store/product";
import { createEntityId } from "../../../src/domain/shared/types";

const storeId = createEntityId();

function makeStore(origin = true): Store {
  return Store.from({
    id: storeId as any,
    ownerId: createEntityId() as any,
    name: "Toko",
    subdomain: "toko",
    description: null,
    businessType: "product" as any,
    aestheticPreference: "modern" as any,
    whatsappNumber: "0812",
    status: "published" as any,
    heroImageUrl: null,
    productCount: 1,
    suspendedAt: null,
    suspendedReason: null,
    createdAt: new Date().toISOString(),
    designTokens: null,
    originAddress: origin ? "Jl. Merdeka 1" : null,
    originPostalCode: origin ? "40111" : null,
    originContactName: origin ? "Budi" : null,
    originContactPhone: origin ? "0812" : null,
    originLatitude: origin ? -6.9 : null,
    originLongitude: origin ? 107.6 : null,
  });
}

function makeProduct(overrides: Partial<{ name: string; price: number; weight: number | null; type: string }> = {}) {
  return Product.create({
    storeId,
    name: overrides.name ?? "Selimut",
    price: overrides.price ?? 100000,
    weight: overrides.weight !== undefined ? overrides.weight : 500,
    width: 10,
    length: 10,
    height: 5,
    type: (overrides.type ?? "product") as any,
  });
}

function mockStoreRepo(store: Store): StoreRepository {
  return { findById: vi.fn().mockResolvedValue(store), save: vi.fn().mockResolvedValue(undefined), findBySubdomain: vi.fn().mockResolvedValue(null), findByOwnerId: vi.fn().mockResolvedValue(null), updateProductCount: vi.fn().mockResolvedValue(undefined) } as unknown as StoreRepository;
}

function mockProductRepo(products: Product[]): ProductRepository {
  return {
    findById: vi.fn(async (id) => products.find((p) => p.id === id) ?? null),
    findByStoreId: vi.fn().mockResolvedValue(products),
    findByStoreSlug: vi.fn().mockResolvedValue(null),
    findVariantsByProductIds: vi.fn().mockResolvedValue([]),
    replaceVariants: vi.fn().mockResolvedValue(undefined),
    deleteVariantsByProductId: vi.fn().mockResolvedValue(undefined),
    save: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    deleteByStoreId: vi.fn().mockResolvedValue(undefined),
    countByStoreId: vi.fn().mockResolvedValue(0),
  } as unknown as ProductRepository;
}

function mockProvider(rates = [
  { courier: "jne", service: "reg", name: "Reguler", duration: "2 - 3 hari", price: 15000, collectionMethod: ["pickup"] },
  { courier: "sicepat", service: "reg", name: "Reguler", duration: "1 - 2 hari", price: 18000, collectionMethod: ["pickup"] },
]): ShippingProviderClient {
  return {
    getRates: vi.fn().mockResolvedValue(rates),
    resolveCoordinates: vi.fn().mockResolvedValue(null),
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
  } as unknown as OrderRepository;
}

describe("GetShippingRates", () => {
  it("quotes standard couriers by postal code", async () => {
    const p = makeProduct();
    const provider = mockProvider();
    const useCase = new GetShippingRates(mockStoreRepo(makeStore()), mockProductRepo([p]), provider);

    const result = await useCase.execute({
      storeId,
      destinationPostalCode: "40231",
      items: [{ productId: p.id, quantity: 2 }],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.map((r) => r.courier)).toEqual(["jne", "sicepat"]);
    }
    expect(provider.getRates).toHaveBeenCalledWith(expect.objectContaining({
      originPostalCode: "40111",
      destinationPostalCode: "40231",
      couriers: ["jne", "sicepat", "jnt", "anteraja"],
    }));
  });

  it("includes instant couriers when origin + destination coordinates resolve", async () => {
    const p = makeProduct();
    const provider = mockProvider();
    (provider.resolveCoordinates as any).mockResolvedValue({ latitude: -6.9, longitude: 107.6 });
    const useCase = new GetShippingRates(mockStoreRepo(makeStore()), mockProductRepo([p]), provider);

    const result = await useCase.execute({
      storeId,
      destinationPostalCode: "40231",
      items: [{ productId: p.id, quantity: 1 }],
    });

    expect(result.ok).toBe(true);
    const arg = (provider.getRates as any).mock.calls[0][0];
    expect(arg.couriers).toContain("gosend");
    expect(arg.originLatitude).toBe(-6.9);
    expect(arg.destinationLatitude).toBe(-6.9);
  });

  it("fails with ORIGIN_MISSING when the store has no shipping origin", async () => {
    const p = makeProduct();
    const useCase = new GetShippingRates(mockStoreRepo(makeStore(false)), mockProductRepo([p]), mockProvider());
    const result = await useCase.execute({ storeId, destinationPostalCode: "40231", items: [{ productId: p.id, quantity: 1 }] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("ORIGIN_MISSING");
  });

  it("fails with WEIGHT_MISSING when a physical product lacks weight", async () => {
    const p = makeProduct({ weight: null });
    const useCase = new GetShippingRates(mockStoreRepo(makeStore()), mockProductRepo([p]), mockProvider());
    const result = await useCase.execute({ storeId, destinationPostalCode: "40231", items: [{ productId: p.id, quantity: 1 }] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("WEIGHT_MISSING");
  });

  it("fails with WEIGHT_MISSING when a physical product lacks dimensions", async () => {
    const p = Product.create({ storeId, name: "Kotak", price: 50000, weight: 500 }); // no width/length/height
    const useCase = new GetShippingRates(mockStoreRepo(makeStore()), mockProductRepo([p]), mockProvider());
    const result = await useCase.execute({ storeId, destinationPostalCode: "40231", items: [{ productId: p.id, quantity: 1 }] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("WEIGHT_MISSING");
  });

  it("ignores non-physical items in the quote", async () => {
    const service = makeProduct({ name: "Jasa", type: "service", weight: null });
    const useCase = new GetShippingRates(mockStoreRepo(makeStore()), mockProductRepo([service]), mockProvider());
    const result = await useCase.execute({ storeId, destinationPostalCode: "40231", items: [{ productId: service.id, quantity: 1 }] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("WEIGHT_MISSING"); // no physical items at all
  });
});

describe("SubmitOrder shipping", () => {
  it("quotes server-side and stores the fee for a courier option", async () => {
    const p = makeProduct({ weight: 500 });
    const provider = mockProvider();
    const orderRepo = mockOrderRepo();
    const useCase = new SubmitOrder(orderRepo, mockProductRepo([p]), mockStoreRepo(makeStore()), provider);

    const result = await useCase.execute({
      storeId,
      customerName: "Budi",
      customerPhone: "0812",
      items: [{ productId: p.id, quantity: 1 }],
      shippingAddress: "Jl. A, Bandung 40231",
      shipping: { type: "courier", courierCompany: "jne", courierType: "reg", destinationPostalCode: "40231" },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.shippingOption).toBe("courier");
      expect(result.value.shippingFee).toBe(15000);
      expect(result.value.shippingCourier).toBe("jne");
      expect(result.value.shippingService).toBe("reg");
      expect(result.value.shippingDuration).toBe("2 - 3 hari");
      expect(result.value.totalAmount).toBe(100000 + 15000); // items + shipping
    }
  });

  it("rejects a courier that is not in the quote", async () => {
    const p = makeProduct();
    const useCase = new SubmitOrder(mockOrderRepo(), mockProductRepo([p]), mockStoreRepo(makeStore()), mockProvider());
    const result = await useCase.execute({
      storeId,
      customerName: "Budi",
      customerPhone: "0812",
      items: [{ productId: p.id, quantity: 1 }],
      shippingAddress: "Jl. A, Bandung 40231",
      shipping: { type: "courier", courierCompany: "jne", courierType: "BOGUS", destinationPostalCode: "40231" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("SHIPPING_RATE_NOT_FOUND");
  });

  it("pickup option: zero fee, no courier, no provider needed", async () => {
    const p = makeProduct();
    const orderRepo = mockOrderRepo();
    const useCase = new SubmitOrder(orderRepo, mockProductRepo([p])); // no storeRepo/provider

    const result = await useCase.execute({
      storeId,
      customerName: "Budi",
      customerPhone: "0812",
      items: [{ productId: p.id, quantity: 1 }],
      shippingAddress: "", // pickup → address not required
      shipping: { type: "pickup" },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.shippingOption).toBe("pickup");
      expect(result.value.shippingFee).toBe(0);
      expect(result.value.totalAmount).toBe(100000);
    }
  });

  it("courier option without a provider fails gracefully", async () => {
    const p = makeProduct();
    const useCase = new SubmitOrder(mockOrderRepo(), mockProductRepo([p])); // no provider
    const result = await useCase.execute({
      storeId,
      customerName: "Budi",
      customerPhone: "0812",
      items: [{ productId: p.id, quantity: 1 }],
      shippingAddress: "Jl. A",
      shipping: { type: "courier", courierCompany: "jne", courierType: "reg", destinationPostalCode: "40231" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("SHIPPING_UNAVAILABLE");
  });
});
