/**
 * SubmitOrder use case.
 */

import type { EntityId } from "../../domain/shared/types";
import type { Result } from "../../domain/shared/types";
import { ok, err } from "../../domain/shared/types";
import { Order } from "../../domain/order/order";
import { isShippingOption, type ShippingOption } from "../../domain/order/types";
import type { Product } from "../../domain/store/product";
import type { OrderRepository } from "../../infrastructure/repos/d1-order-repo";
import type { ProductRepository } from "../../infrastructure/repos/d1-product-repo";
import type { StoreRepository } from "../store/store-repo";
import type { ShippingProviderClient } from "../../infrastructure/shipping/biteship-client";
import { GetShippingRates } from "../shipping/get-shipping-rates";

export interface SubmitOrderItemInput {
  productId: EntityId;
  /** Optional chosen variant (size/color). Price snapshots the variant. */
  variantId?: EntityId | null;
  quantity: number;
}

export interface SubmitOrderShippingInput {
  type: ShippingOption;
  courierCompany?: string;
  courierType?: string;
  destinationPostalCode?: string;
}

/** Structured destination persisted with the order (powers Biteship resi). */
export interface SubmitOrderDestinationInput {
  detail?: string | null;
  kelurahan?: string | null;
  kecamatan?: string | null;
  city?: string | null;
  province?: string | null;
  postalCode?: string | null;
}

export interface SubmitOrderInput {
  storeId: EntityId;
  customerName: string;
  customerPhone: string;
  items: SubmitOrderItemInput[];
  notes?: string;
  shippingAddress?: string;
  shipping?: SubmitOrderShippingInput;
  destination?: SubmitOrderDestinationInput;
}

export interface SubmitOrderError {
  code: "VALIDATION" | "PRODUCT_UNAVAILABLE" | "STOCK_INSUFFICIENT" | "VARIANT_NOT_FOUND" | "SHIPPING_UNAVAILABLE" | "SHIPPING_RATE_NOT_FOUND";
  message: string;
  field?: string;
}

export class SubmitOrder {
  constructor(
    private readonly orderRepo: OrderRepository,
    private readonly productRepo: ProductRepository,
    private readonly storeRepo?: StoreRepository,
    private readonly provider?: ShippingProviderClient,
  ) {}

  async execute(input: SubmitOrderInput): Promise<Result<ReturnType<Order["toJSON"]>, SubmitOrderError>> {
    // Validate
    if (!input.customerName.trim()) {
      return err({ code: "VALIDATION", message: "Nama wajib diisi.", field: "customerName" });
    }
    if (!input.customerPhone.trim()) {
      return err({ code: "VALIDATION", message: "Nomor HP wajib diisi.", field: "customerPhone" });
    }
    if (input.items.length === 0) {
      return err({ code: "VALIDATION", message: "Pesanan harus memiliki minimal 1 produk.", field: "items" });
    }

    // Fetch products from DB (never trust client prices)
    const productIds = input.items.map((i) => i.productId);
    const products = await Promise.all(productIds.map((id) => this.productRepo.findById(id)));
    const byId = new Map(products.filter((p): p is Product => !!p).map((p) => [p.id as string, p]));
    // All variants for the ordered products — used to resolve variant prices.
    const variants = await this.productRepo.findVariantsByProductIds(productIds);
    const variantById = new Map(variants.map((v) => [v.id as string, v]));

    const orderItems: {
      productId: EntityId;
      productName: string;
      quantity: number;
      unitPrice: number;
      productType: Product["type"];
      variantName?: string | null;
    }[] = [];
    // Products whose stock was reserved — persisted after the order is saved.
    const reserved: Product[] = [];

    for (const item of input.items) {
      const product = byId.get(item.productId as string);
      if (!product || !product.isAvailable) {
        return err({ code: "PRODUCT_UNAVAILABLE", message: `Produk tidak tersedia.`, field: "items" });
      }
      if (item.quantity < 1) {
        return err({ code: "VALIDATION", message: "Jumlah minimal 1.", field: "items" });
      }

      // Stock gate — never oversell tracked products.
      if (product.stock !== null && product.stock < item.quantity) {
        return err({ code: "STOCK_INSUFFICIENT", message: `Stok ${product.name} tidak mencukupi (sisa ${product.stock}).`, field: "items" });
      }
      if (product.stock !== null) {
        product.reserveStock(item.quantity);
        reserved.push(product);
      }

      // Resolve the chosen variant (if any) — price snapshots the variant.
      let unitPrice = product.effectivePrice;
      let variantName: string | null = null;
      if (item.variantId) {
        const variant = variantById.get(item.variantId as string);
        if (!variant || variant.productId !== product.id) {
          return err({ code: "VARIANT_NOT_FOUND", message: "Varian produk tidak ditemukan.", field: "items" });
        }
        unitPrice = variant.price ?? product.effectivePrice;
        variantName = variant.name;
      }

      orderItems.push({
        productId: product.id,
        productName: product.name,
        quantity: item.quantity,
        unitPrice,
        productType: product.type,
        variantName,
      });
    }

    // Physical products must always carry a shipping address (unless pickup/manual)
    const hasPhysicalItem = orderItems.some((i) => i.productType === "product");
    const shipsByCourier = !input.shipping || input.shipping.type === "courier";
    if (hasPhysicalItem && shipsByCourier && !input.shippingAddress?.trim()) {
      return err({ code: "VALIDATION", message: "Alamat pengiriman wajib diisi.", field: "shippingAddress" });
    }

    // ---------------------------------------------------------------------
    // Shipping — never trust client fees; re-quote via the provider.
    // ---------------------------------------------------------------------
    let shippingOption: ShippingOption | null = null;
    let shippingFee = 0;
    let shippingCourier: string | null = null;
    let shippingService: string | null = null;
    let shippingDuration: string | null = null;

    const ship = input.shipping;
    if (hasPhysicalItem && ship) {
      if (!isShippingOption(ship.type)) {
        return err({ code: "VALIDATION", message: "Metode pengiriman tidak valid.", field: "shipping" });
      }
      shippingOption = ship.type;

      if (ship.type === "courier") {
        if (!ship.courierCompany || !ship.courierType) {
          return err({ code: "VALIDATION", message: "Pilih kurir pengiriman.", field: "shipping" });
        }
        if (!this.storeRepo || !this.provider) {
          return err({ code: "SHIPPING_UNAVAILABLE", message: "Pengiriman online belum tersedia di toko ini." });
        }
        const rates = await new GetShippingRates(this.storeRepo, this.productRepo, this.provider).execute({
          storeId: input.storeId,
          destinationPostalCode: ship.destinationPostalCode ?? "",
          items: input.items,
        });
        if (!rates.ok) {
          return err({ code: "SHIPPING_UNAVAILABLE", message: rates.error.message });
        }
        const chosen = rates.value.find(
          (r) => r.courier === ship.courierCompany && r.service === ship.courierType,
        );
        if (!chosen) {
          return err({ code: "SHIPPING_RATE_NOT_FOUND", message: "Kurir tidak tersedia untuk alamat ini." });
        }
        shippingFee = chosen.price;
        shippingCourier = chosen.courier;
        shippingService = chosen.service;
        shippingDuration = chosen.duration;
      }
      // pickup / manual → fee 0, no courier
    }

    // Create order
    const order = Order.create({
      storeId: input.storeId,
      customerName: input.customerName,
      customerPhone: input.customerPhone,
      items: orderItems,
      notes: input.notes,
      shippingAddress: input.shippingAddress,
      shippingOption,
      shippingFee,
      shippingCourier,
      shippingService,
      shippingDuration,
      destination: input.destination,
    });

    await this.orderRepo.save(order);

    // Persist reserved stock (only for tracked products).
    for (const p of reserved) {
      await this.productRepo.save(p);
    }

    return ok(order.toJSON());
  }
}
