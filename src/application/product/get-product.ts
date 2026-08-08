/**
 * GetProduct use case — fetch a single product by id.
 *
 * Used by the storefront product detail page (public when the store is
 * published) and by the dashboard.
 */

import type { EntityId } from "../../domain/shared/types";
import type { Result } from "../../domain/shared/types";
import { ok, err } from "../../domain/shared/types";
import { Product } from "../../domain/store/product";
import type { ProductRepository } from "../../infrastructure/repos/d1-product-repo";
import type { ProductWithVariants } from "./create-product";

export interface GetProductError {
  code: "NOT_FOUND";
  message: string;
}

export class GetProduct {
  constructor(private readonly productRepo: ProductRepository) {}

  async execute(input: { productId: EntityId }): Promise<Result<ProductWithVariants, GetProductError>> {
    const product = await this.productRepo.findById(input.productId);
    if (!product) {
      return err({ code: "NOT_FOUND", message: "Produk tidak ditemukan." });
    }
    const variants = (await this.productRepo.findVariantsByProductIds([product.id])).map((v) => v.toJSON());
    return ok({ ...product.toJSON(), variants });
  }
}

/** Same as GetProduct but resolves by store-unique URL slug (falls back to
 *  id so legacy pre-slug product links keep working). */
export class GetProductBySlug {
  constructor(private readonly productRepo: ProductRepository) {}

  async execute(input: { storeId: EntityId; slug: string }): Promise<Result<ProductWithVariants, GetProductError>> {
    let product = await this.productRepo.findByStoreSlug(input.storeId, input.slug);
    if (!product) {
      // Legacy id-based links (products created before slugs existed).
      const byId = await this.productRepo.findById(input.slug as EntityId);
      if (byId && byId.storeId === input.storeId) product = byId;
    }
    if (!product) {
      return err({ code: "NOT_FOUND", message: "Produk tidak ditemukan." });
    }
    const variants = (await this.productRepo.findVariantsByProductIds([product.id])).map((v) => v.toJSON());
    return ok({ ...product.toJSON(), variants });
  }
}
