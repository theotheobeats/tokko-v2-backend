/**
 * PublishStore use case.
 */

import type { EntityId } from "../../domain/shared/types";
import type { Result } from "../../domain/shared/types";
import { ok, err } from "../../domain/shared/types";
import { Store } from "../../domain/store/store";
import type { StoreRepository } from "./store-repo";

export interface PublishStoreInput {
  storeId: EntityId;
}

export interface PublishStoreError {
  code: "NOT_FOUND" | "STORE_HAS_NO_PRODUCTS";
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

    const result = store.publish();
    if (!result.ok) {
      return err({ code: "STORE_HAS_NO_PRODUCTS", message: "Toko harus memiliki minimal 1 produk untuk publish." });
    }

    await this.storeRepo.save(store);
    return ok(store.toJSON());
  }
}
