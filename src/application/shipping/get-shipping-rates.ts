/**
 * GetShippingRates use case — Biteship courier options for a checkout cart.
 *
 * Weights + values come from the DB (never trust the client). Standard
 * couriers quote via postal codes; instant couriers (Gojek/Grab) are
 * included when the store has origin coordinates and the destination
 * postal code resolves to coordinates (best-effort — never fails the quote).
 */

import type { EntityId } from "../../domain/shared/types";
import type { Result } from "../../domain/shared/types";
import { ok, err } from "../../domain/shared/types";
import type { StoreRepository } from "../store/store-repo";
import type { ProductRepository } from "../../infrastructure/repos/d1-product-repo";
import type { ShippingProviderClient } from "../../infrastructure/shipping/biteship-client";

export interface GetShippingRatesInput {
  storeId: EntityId;
  destinationPostalCode: string;
  items: { productId: EntityId; quantity: number }[];
}

export interface ShippingRateOption {
  courier: string;
  service: string;
  name: string;
  duration: string;
  price: number;
  collectionMethod: string[];
}

export interface GetShippingRatesError {
  code: "NOT_FOUND" | "ORIGIN_MISSING" | "DESTINATION_MISSING" | "WEIGHT_MISSING" | "PROVIDER_UNAVAILABLE";
  message: string;
}

const STANDARD_COURIERS = ["jne", "sicepat", "jnt", "anteraja"];
const INSTANT_COURIERS = ["gosend", "grab"];

export class GetShippingRates {
  constructor(
    private readonly storeRepo: StoreRepository,
    private readonly productRepo: ProductRepository,
    private readonly provider: ShippingProviderClient,
  ) {}

  async execute(input: GetShippingRatesInput): Promise<Result<ShippingRateOption[], GetShippingRatesError>> {
    const store = await this.storeRepo.findById(input.storeId);
    if (!store) return err({ code: "NOT_FOUND", message: "Toko tidak ditemukan." });
    if (!store.hasShippingOrigin) {
      return err({ code: "ORIGIN_MISSING", message: "Lengkapi alamat pengiriman toko di Pengaturan." });
    }
    if (!input.destinationPostalCode.trim()) {
      return err({ code: "DESTINATION_MISSING", message: "Kode pos tujuan belum lengkap." });
    }

    // Weights/dimensions from DB — only physical (product) items ship.
    // Weight + dimensions are required so courier volumetric pricing works.
    const items: { name: string; value: number; quantity: number; weight: number; length: number; width: number; height: number }[] = [];
    for (const line of input.items) {
      const product = await this.productRepo.findById(line.productId);
      if (!product || product.type !== "product") continue; // cart re-hydrates removed items
      if (product.weight == null || product.length == null || product.width == null || product.height == null) {
        return err({ code: "WEIGHT_MISSING", message: `Lengkapi berat & dimensi (P×L×T) produk "${product.name}" di dashboard agar ongkir bisa dihitung.` });
      }
      items.push({
        name: product.name,
        value: product.effectivePrice,
        quantity: line.quantity,
        weight: product.weight,
        length: product.length,
        width: product.width,
        height: product.height,
      });
    }
    if (items.length === 0) {
      return err({ code: "WEIGHT_MISSING", message: "Tidak ada produk fisik untuk dikirim." });
    }

    // Unlock instant couriers when origin coords exist + destination resolves.
    let originLat: number | undefined;
    let originLng: number | undefined;
    let destLat: number | undefined;
    let destLng: number | undefined;
    if (store.originLatitude != null && store.originLongitude != null) {
      const dest = await this.provider.resolveCoordinates(input.destinationPostalCode);
      if (dest) {
        originLat = store.originLatitude;
        originLng = store.originLongitude;
        destLat = dest.latitude;
        destLng = dest.longitude;
      }
    }

    // Couriers = the store's enabled list (falls back to platform defaults).
    // Instant couriers only join the quote when coordinates resolved.
    const storeCouriers = store.enabledCouriers?.length ? store.enabledCouriers : [...STANDARD_COURIERS, ...INSTANT_COURIERS];
    const couriers = destLat != null
      ? storeCouriers.filter((c) => [...STANDARD_COURIERS, ...INSTANT_COURIERS].includes(c))
      : storeCouriers.filter((c) => STANDARD_COURIERS.includes(c));

    try {
      const rates = await this.provider.getRates({
        originPostalCode: store.originPostalCode ?? undefined,
        destinationPostalCode: input.destinationPostalCode,
        originLatitude: originLat,
        originLongitude: originLng,
        destinationLatitude: destLat,
        destinationLongitude: destLng,
        couriers,
        items,
      });
      return ok(rates);
    } catch {
      return err({ code: "PROVIDER_UNAVAILABLE", message: "Pengiriman online belum tersedia di toko ini." });
    }
  }
}
