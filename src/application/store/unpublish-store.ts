/**
 * UnpublishStore use case.
 */

import type { EntityId } from "../../domain/shared/types";
import type { Result } from "../../domain/shared/types";
import { ok, err } from "../../domain/shared/types";
import { Store } from "../../domain/store/store";
import type { StoreRepository } from "./store-repo";

export interface UnpublishStoreInput {
  storeId: EntityId;
}

export interface UnpublishStoreError {
  code: "NOT_FOUND";
  message: string;
}

export class UnpublishStore {
  constructor(private readonly storeRepo: StoreRepository) {}

  async execute(input: UnpublishStoreInput): Promise<Result<ReturnType<Store["toJSON"]>, UnpublishStoreError>> {
    const store = await this.storeRepo.findById(input.storeId);
    if (!store) {
      return err({ code: "NOT_FOUND", message: "Toko tidak ditemukan." });
    }

    store.unpublish();
    await this.storeRepo.save(store);

    return ok(store.toJSON());
  }
}
