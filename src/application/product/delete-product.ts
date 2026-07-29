/**
 * DeleteProduct use case.
 */

import type { EntityId } from "../../domain/shared/types";
import type { Result } from "../../domain/shared/types";
import { ok, err } from "../../domain/shared/types";
import type { ProductRepository } from "../../infrastructure/repos/d1-product-repo";

export interface DeleteProductInput {
  productId: EntityId;
}

export interface DeleteProductError {
  code: "NOT_FOUND";
  message: string;
}

export class DeleteProduct {
  constructor(private readonly productRepo: ProductRepository) {}

  async execute(input: DeleteProductInput): Promise<Result<null, DeleteProductError>> {
    const product = await this.productRepo.findById(input.productId);
    if (!product) {
      return err({ code: "NOT_FOUND", message: "Produk tidak ditemukan." });
    }

    await this.productRepo.delete(input.productId);
    return ok(null);
  }
}
