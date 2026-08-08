/**
 * ListRelatedProducts use case — other available products in the same store.
 *
 * Powers the "Produk Lainnya" strip on the storefront product detail page.
 * Products sharing the current product's category are listed first
 * (landofmoe-style "related" ordering), then the rest.
 */

import type { EntityId } from "../../domain/shared/types";
import type { Result } from "../../domain/shared/types";
import { ok } from "../../domain/shared/types";
import { Product } from "../../domain/store/product";
import { ProductVariant } from "../../domain/store/variant";
import type { ProductRepository } from "../../infrastructure/repos/d1-product-repo";
import type { ProductWithVariants } from "./create-product";

/** Cap on how many related products the detail page shows. */
export const RELATED_PRODUCTS_LIMIT = 8;

type VariantJson = ReturnType<ProductVariant["toJSON"]>;

export class ListRelatedProducts {
  constructor(private readonly productRepo: ProductRepository) {}

  async execute(input: {
    storeId: EntityId;
    productId: EntityId;
  }): Promise<Result<ProductWithVariants[], never>> {
    // productId may be a slug (detail page links) or a legacy id — resolve
    // either so category-preference ordering still works from slug URLs.
    const bySlug = await this.productRepo.findByStoreSlug(input.storeId, input.productId as string);
    const product = bySlug ?? (await this.productRepo.findById(input.productId));
    const products = await this.productRepo.findByStoreId(input.storeId);
    const others = products.filter((p) => p.isAvailable && p.id !== product?.id);

    // Same-category products first (stable: keeps store order within each group).
    const categoryId = product?.categoryId ?? null;
    const related = [...others].sort((a, b) => {
      const aSame = a.categoryId !== null && a.categoryId === categoryId ? 0 : 1;
      const bSame = b.categoryId !== null && b.categoryId === categoryId ? 0 : 1;
      return aSame - bSame;
    }).slice(0, RELATED_PRODUCTS_LIMIT);

    const variants = await this.productRepo.findVariantsByProductIds(related.map((p) => p.id));
    const byProduct = new Map<string, VariantJson[]>();
    for (const v of variants) {
      const list = byProduct.get(v.productId as string) ?? [];
      list.push(v.toJSON());
      byProduct.set(v.productId as string, list);
    }

    return ok(related.map((p) => ({ ...p.toJSON(), variants: byProduct.get(p.id as string) ?? [] })));
  }
}
