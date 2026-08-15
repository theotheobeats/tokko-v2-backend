/**
 * CreateDeliveryOrder — merchant creates a Biteship delivery order (resi)
 * for a paid courier order. Uses the order's persisted structured destination
 * + the store's origin; item weights come from the product repo (never the
 * client). Stores the waybill as the order's tracking number.
 */

import type { EntityId } from "../../domain/shared/types";
import type { Result } from "../../domain/shared/types";
import { ok, err } from "../../domain/shared/types";
import type { Order } from "../../domain/order/order";
import type { OrderRepository } from "../../infrastructure/repos/d1-order-repo";
import type { StoreRepository } from "../store/store-repo";
import type { ProductRepository } from "../../infrastructure/repos/d1-product-repo";
import type { ShippingProviderClient, DeliveryOrderResult } from "../../infrastructure/shipping/biteship-client";

export class DeliveryOrderNotFoundError extends Error { code = "ORDER_NOT_FOUND"; constructor() { super("Pesanan tidak ditemukan"); } }
export class DeliveryOrderNotPaidError extends Error { code = "NOT_PAID"; constructor() { super("Pesanan belum dibayar."); } }
export class DeliveryOrderEpaymentRequiredError extends Error {
  code = "EPAYMENT_REQUIRED";
  constructor() { super("Biteship tersedia di paket Pro/Commerce dengan pembayaran online."); }
}
export class DeliveryOrderNoShippingError extends Error { code = "NO_SHIPPING"; constructor() { super("Pesanan tidak memakai kurir."); } }
export class DeliveryOrderAlreadyShippedError extends Error { code = "ALREADY_SHIPPED"; constructor() { super("Resi sudah dibuat untuk pesanan ini."); } }
export class DeliveryOrderDestinationMissingError extends Error { code = "DESTINATION_MISSING"; constructor() { super("Alamat tujuan belum lengkap — minta pembeli mengisi alamat lengkap."); } }
export class DeliveryOrderWeightMissingError extends Error { code = "WEIGHT_MISSING"; constructor(message: string) { super(message); } }
export class DeliveryOrderProviderError extends Error { code = "PROVIDER_UNAVAILABLE"; constructor(message: string) { super(message); } }

export class CreateDeliveryOrder {
  constructor(
    private readonly orderRepo: OrderRepository,
    private readonly storeRepo: StoreRepository,
    private readonly productRepo: ProductRepository,
    private readonly provider: ShippingProviderClient,
  ) {}

  async execute(input: {
    storeId: EntityId;
    orderId: EntityId;
    collectionMethod?: "pickup" | "drop_off";
  }): Promise<Result<
    { order: ReturnType<Order["toJSON"]>; awb: string; courier: string | null; price: number },
    DeliveryOrderNotFoundError | DeliveryOrderNotPaidError | DeliveryOrderNoShippingError |
    DeliveryOrderAlreadyShippedError | DeliveryOrderDestinationMissingError |
    DeliveryOrderWeightMissingError | DeliveryOrderProviderError
  >> {
    const store = await this.storeRepo.findById(input.storeId);
    if (!store) return err(new DeliveryOrderNotFoundError());

    const order = await this.orderRepo.findById(input.orderId);
    if (!order || order.storeId !== input.storeId) return err(new DeliveryOrderNotFoundError());

    if (!order.paymentConfirmed) return err(new DeliveryOrderNotPaidError());
    // Biteship is gated on e-payment: trial/manual-only stores have no
    // platform-managed money to recover the courier cost from (no subsidy).
    if (!store.paymentOnline) return err(new DeliveryOrderEpaymentRequiredError());
    if (!order.shippingCourier || !order.shippingService) return err(new DeliveryOrderNoShippingError());
    if (order.trackingNumber || order.biteshipOrderId) return err(new DeliveryOrderAlreadyShippedError());

    // Destination: structured fields when present; otherwise fall back to the
    // composed shipping address (orders created before structured destination
    // was persisted) — the postal code is extracted from the address string.
    const destPostal =
      order.destinationPostalCode ??
      order.shippingAddress?.match(/\b\d{5}\b/)?.[0] ??
      "";
    const destAddress = order.destinationDetail
      ? composeDestination(order)
      : (order.shippingAddress?.trim() ?? "");
    if (!destPostal || !destAddress) return err(new DeliveryOrderDestinationMissingError());

    // Item weights from the product repo — never the client.
    const items: { name: string; value: number; quantity: number; weight: number; length?: number; width?: number; height?: number }[] = [];
    for (const line of order.items) {
      const product = await this.productRepo.findById(line.productId);
      if (!product || product.type !== "product") continue;
      if (product.weight == null) {
        return err(new DeliveryOrderWeightMissingError(`Lengkapi berat produk "${product.name}" di dashboard sebelum membuat resi.`));
      }
      items.push({
        name: line.productName,
        value: line.unitPrice,
        quantity: line.quantity,
        weight: product.weight,
        ...(product.length != null && product.width != null && product.height != null
          ? { length: product.length, width: product.width, height: product.height }
          : {}),
      });
    }
    if (items.length === 0) {
      return err(new DeliveryOrderWeightMissingError("Tidak ada produk fisik untuk dikirim."));
    }

    // Resolve origin/destination areas (best-effort; postal codes always sent).
    const [originArea, destArea] = await Promise.all([
      this.provider.resolveArea(store.originPostalCode ?? ""),
      this.provider.resolveArea(destPostal),
    ]);

    let result: DeliveryOrderResult;
    try {
      result = await this.provider.createOrder({
        referenceId: order.orderCode,
        shipper: {
          contactName: store.originContactName ?? store.name,
          contactPhone: store.originContactPhone ?? store.whatsappNumber ?? "",
          address: store.fullOriginAddress ?? store.originAddress ?? "",
          postalCode: store.originPostalCode ?? "",
          areaId: originArea?.areaId ?? null,
          coordinates:
            store.originLatitude != null && store.originLongitude != null
              ? { latitude: store.originLatitude, longitude: store.originLongitude }
              : originArea
                ? { latitude: originArea.latitude, longitude: originArea.longitude }
                : null,
        },
        recipient: {
          name: order.customerName,
          phone: order.customerPhone,
          address: destAddress,
          postalCode: destPostal,
          areaId: destArea?.areaId ?? null,
          coordinates: destArea ? { latitude: destArea.latitude, longitude: destArea.longitude } : null,
        },
        courierCompany: order.shippingCourier,
        courierType: order.shippingService,
        collectionMethod: input.collectionMethod ?? "pickup",
        items,
      });
    } catch (e) {
      return err(new DeliveryOrderProviderError(e instanceof Error ? e.message : "Pengiriman online belum tersedia di toko ini."));
    }

    // Persist the waybill as the order's resi + the Biteship refs.
    order.updateFulfillment({ trackingNumber: result.waybillId, courier: order.shippingCourier });
    order.attachBiteship({ deliveryOrderId: result.deliveryOrderId, trackingId: result.trackingId });
    await this.orderRepo.save(order);

    return ok({
      order: order.toJSON(),
      awb: result.waybillId,
      courier: order.shippingCourier,
      price: result.price,
    });
  }
}

function composeDestination(order: { destinationDetail: string | null; destinationKelurahan: string | null; destinationKecamatan: string | null; destinationCity: string | null; destinationProvince: string | null; destinationPostalCode: string | null }): string {
  const parts = [
    order.destinationDetail,
    order.destinationKelurahan,
    order.destinationKecamatan,
    order.destinationCity,
    order.destinationProvince,
  ].filter((s): s is string => Boolean(s?.trim()));
  return parts.join(", ");
}
