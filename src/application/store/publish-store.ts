/**
 * PublishStore use case.
 */

import type { EntityId } from "../../domain/shared/types";
import type { Result } from "../../domain/shared/types";
import { ok, err } from "../../domain/shared/types";
import { Store } from "../../domain/store/store";
import { StoreOriginIncompleteError, StoreBankIncompleteError, StoreProductsMissingShippingError } from "../../domain/store/rules";
import type { StoreRepository } from "./store-repo";

export interface PublishStoreInput {
  storeId: EntityId;
}

export interface PublishStoreError {
  code: "NOT_FOUND" | "STORE_HAS_NO_PRODUCTS" | "STORE_ORIGIN_INCOMPLETE" | "STORE_BANK_INCOMPLETE" | "PRODUCTS_MISSING_SHIPPING_DETAILS";
  message: string;
}

export class PublishStore {
  constructor(private readonly storeRepo: StoreRepository) {}

  async execute(input: PublishStoreInput): Promise<Result<ReturnType<Store["toJSON"]>, PublishStoreError>> {
    const store = await this.storeRepo.findById(input.storeId);
    if (!store) {
      return err({ code: "NOT_FOUND", message: "Toko tidak ditemukan." });
    }

    // Check product count
    const productCount = await this.storeRepo.countProducts(store.id);
    store.setProductCount(productCount);

    // Physical products need weight + dimensions for Biteship rates.
    const missingShipping = await this.storeRepo.countPhysicalProductsMissingShipping(store.id);
    store.setPhysicalProductsMissingShipping(missingShipping);

    const result = store.publish();
    if (!result.ok) {
      const error = result.error;
      if (error instanceof StoreOriginIncompleteError) {
        return err({ code: "STORE_ORIGIN_INCOMPLETE", message: "Lengkapi Alamat Pengiriman (asal) di tab Pengiriman sebelum publish." });
      }
      if (error instanceof StoreBankIncompleteError) {
        return err({ code: "STORE_BANK_INCOMPLETE", message: "Lengkapi Rekening Pembayaran (bank, no. rekening, atas nama) di tab Pembayaran sebelum publish." });
      }
      if (error instanceof StoreProductsMissingShippingError) {
        return err({
          code: "PRODUCTS_MISSING_SHIPPING_DETAILS",
          message: `${error.count} produk fisik belum lengkap berat & dimensinya — isi di halaman Produk sebelum publish.`,
        });
      }
      return err({ code: "STORE_HAS_NO_PRODUCTS", message: "Toko harus memiliki minimal 1 produk untuk publish." });
    }

    await this.storeRepo.save(store);
    return ok(store.toJSON());
  }
}
