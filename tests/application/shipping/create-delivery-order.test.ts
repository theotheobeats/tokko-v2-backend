import { describe, it, expect, vi } from "vitest";
import {
  CreateDeliveryOrder,
  DeliveryOrderAlreadyShippedError,
  DeliveryOrderDestinationMissingError,
  DeliveryOrderEpaymentRequiredError,
  DeliveryOrderNoShippingError,
  DeliveryOrderNotPaidError,
} from "../../../src/application/shipping/create-delivery-order";
import type { OrderRepository } from "../../../src/infrastructure/repos/d1-order-repo";
import type { StoreRepository } from "../../../src/application/store/store-repo";
import type { ProductRepository } from "../../../src/infrastructure/repos/d1-product-repo";
import type { ShippingProviderClient } from "../../../src/infrastructure/shipping/biteship-client";
import { Order } from "../../../src/domain/order/order";
import { Store } from "../../../src/domain/store/store";
import { Product } from "../../../src/domain/store/product";
import { BusinessType, Aesthetic } from "../../../src/domain/store/types";
import { createEntityId } from "../../../src/domain/shared/types";

const STORE_ID = createEntityId();
const ORDER_ID = createEntityId();

function makeStore(): Store {
  const store = Store.create({
    ownerId: createEntityId(),
    name: "Titulabs",
    businessType: BusinessType.Fashion,
    aestheticPreference: Aesthetic.Minimal,
    whatsappNumber: "081234567890",
  });
  store.updateShippingOrigin({
    originAddress: "Jl. Merdeka 1",
    originRt: "01",
    originRw: "02",
    originKelurahan: "Sukamaju",
    originKecamatan: "Sako",
    originCity: "Palembang",
    originProvince: "Sumatera Selatan",
    originPostalCode: "40111",
    originContactName: "Budi",
    originContactPhone: "0811",
    originLatitude: -6.9,
    originLongitude: 107.6,
  });
  return store;
}

function makeOrder(overrides: Record<string, unknown> = {}): Order {
  return Order.from({
    id: ORDER_ID as never,
    storeId: STORE_ID as never,
    orderCode: "TK-ABC",
    customerName: "Rina",
    customerPhone: "0812",
    items: [{ productId: "p1" as never, productName: "Selimut", quantity: 1, unitPrice: 100000, productType: "product" } as never],
    totalAmount: 115000,
    status: "pending",
    notes: null,
    shippingAddress: "Jl. Ciumbuleuit 1, Sukamaju, Sako, Palembang, Sumatera Selatan 30163",
    trackingNumber: null,
    courier: null,
    paymentConfirmed: true,
    paymentNote: "Dibayar via QRIS",
    queueNumber: null,
    shippingOption: "courier",
    shippingFee: 15000,
    shippingCourier: "jne",
    shippingService: "reg",
    shippingDuration: "2 - 3 hari",
    destinationDetail: "Jl. Ciumbuleuit 1",
    destinationKelurahan: "Sukamaju",
    destinationKecamatan: "Sako",
    destinationCity: "Palembang",
    destinationProvince: "Sumatera Selatan",
    destinationPostalCode: "30163",
    biteshipOrderId: null,
    biteshipTrackingId: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  } as never);
}

function makeProduct(): Product {
  return Product.create({
    storeId: STORE_ID,
    name: "Selimut",
    price: 100000,
    weight: 500,
    width: 10,
    length: 10,
    height: 5,
  });
}

function mocks() {
  const storeRepo = { findById: vi.fn().mockResolvedValue(makeStore()), save: vi.fn() } as unknown as StoreRepository;
  const orderRepo = { findById: vi.fn(), save: vi.fn().mockResolvedValue(undefined) } as unknown as OrderRepository;
  const productRepo = { findById: vi.fn().mockResolvedValue(makeProduct()) } as unknown as ProductRepository;
  const provider = {
    resolveArea: vi.fn().mockResolvedValue(null),
    createOrder: vi.fn().mockResolvedValue({ deliveryOrderId: "dlv-1", waybillId: "WYB-1234567890", trackingId: "trk-1", status: "confirmed", price: 15000 }),
  } as unknown as ShippingProviderClient;
  return { storeRepo, orderRepo, productRepo, provider };
}

describe("CreateDeliveryOrder", () => {
  it("creates a Biteship delivery order and stores the waybill as resi", async () => {
    const { storeRepo, orderRepo, productRepo, provider } = mocks();
    const order = makeOrder();
    orderRepo.findById = vi.fn().mockResolvedValue(order);

    const result = await new CreateDeliveryOrder(orderRepo, storeRepo, productRepo, provider).execute({
      storeId: STORE_ID,
      orderId: ORDER_ID,
      collectionMethod: "drop_off",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.awb).toBe("WYB-1234567890");
      expect(result.value.order.trackingNumber).toBe("WYB-1234567890");
      expect(result.value.order.biteshipOrderId).toBe("dlv-1");
    }
    expect(provider.createOrder).toHaveBeenCalledWith(expect.objectContaining({
      referenceId: "TK-ABC",
      courierCompany: "jne",
      courierType: "reg",
      collectionMethod: "drop_off",
    }));
    expect(orderRepo.save).toHaveBeenCalled();
  });

  it("rejects unpaid orders", async () => {
    const { storeRepo, orderRepo, productRepo, provider } = mocks();
    orderRepo.findById = vi.fn().mockResolvedValue(makeOrder({ paymentConfirmed: false }));
    const result = await new CreateDeliveryOrder(orderRepo, storeRepo, productRepo, provider).execute({ storeId: STORE_ID, orderId: ORDER_ID });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(DeliveryOrderNotPaidError);
  });

  it("rejects stores without e-payment (trial/manual-only — platform would subsidize Biteship)", async () => {
    const { storeRepo, orderRepo, productRepo, provider } = mocks();
    const store = makeStore();
    store.setPaymentOnline(false); // trial / KYB not done → e-payment off
    storeRepo.findById = vi.fn().mockResolvedValue(store);
    orderRepo.findById = vi.fn().mockResolvedValue(makeOrder());
    const result = await new CreateDeliveryOrder(orderRepo, storeRepo, productRepo, provider).execute({ storeId: STORE_ID, orderId: ORDER_ID });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(DeliveryOrderEpaymentRequiredError);
    expect(provider.createOrder).not.toHaveBeenCalled();
  });

  it("rejects orders without courier shipping", async () => {
    const { storeRepo, orderRepo, productRepo, provider } = mocks();
    orderRepo.findById = vi.fn().mockResolvedValue(makeOrder({ shippingCourier: null, shippingService: null }));
    const result = await new CreateDeliveryOrder(orderRepo, storeRepo, productRepo, provider).execute({ storeId: STORE_ID, orderId: ORDER_ID });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(DeliveryOrderNoShippingError);
  });

  it("rejects orders that already have a resi", async () => {
    const { storeRepo, orderRepo, productRepo, provider } = mocks();
    orderRepo.findById = vi.fn().mockResolvedValue(makeOrder({ trackingNumber: "WYB-OLD" }));
    const result = await new CreateDeliveryOrder(orderRepo, storeRepo, productRepo, provider).execute({ storeId: STORE_ID, orderId: ORDER_ID });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(DeliveryOrderAlreadyShippedError);
  });

  it("rejects orders with an incomplete destination (no structured fields AND no postal in the composed address)", async () => {
    const { storeRepo, orderRepo, productRepo, provider } = mocks();
    orderRepo.findById = vi.fn().mockResolvedValue(makeOrder({ destinationPostalCode: null, destinationDetail: null, shippingAddress: "Jl. Tanpa Kode Pos" }));
    const result = await new CreateDeliveryOrder(orderRepo, storeRepo, productRepo, provider).execute({ storeId: STORE_ID, orderId: ORDER_ID });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(DeliveryOrderDestinationMissingError);
  });

  it("falls back to the composed shipping address for legacy orders without structured destination", async () => {
    const { storeRepo, orderRepo, productRepo, provider } = mocks();
    orderRepo.findById = vi.fn().mockResolvedValue(makeOrder({ destinationPostalCode: null, destinationDetail: null }));

    const result = await new CreateDeliveryOrder(orderRepo, storeRepo, productRepo, provider).execute({ storeId: STORE_ID, orderId: ORDER_ID });

    expect(result.ok).toBe(true);
    const arg = (provider.createOrder as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.recipient.postalCode).toBe("30163"); // extracted from the composed address
    expect(arg.recipient.address).toContain("Jl. Ciumbuleuit 1");
  });
});
