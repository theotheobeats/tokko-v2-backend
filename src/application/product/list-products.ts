/**
 * ListProducts use case.
 */

import type { EntityId } from "../../domain/shared/types";
import type { Result } from "../../domain/shared/types";
import { ok } from "../../domain/shared/types";
import { Product } from "../../domain/store/product";
import type { ProductRepository } from "../../infrastructure/repos/d1-product-repo";

export interface ListProductsInput {
  storeId: EntityId;
}

export class ListProducts {
  constructor(private readonly productRepo: ProductRepository) {}

  async execute(input: ListProductsInput): Promise<Result<ReturnType<Product["toJSON"]>[], never>> {
    const products = await this.productRepo.findByStoreId(input.storeId);
    return ok(products.map((p) => p.toJSON()));
  }
}
