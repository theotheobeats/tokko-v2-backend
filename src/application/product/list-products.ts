/**
 * ListProducts use case — all products of a store (optionally filtered by
 * category and sorted), variants embedded.
 */

import type { EntityId } from "../../domain/shared/types";
import type { Result } from "../../domain/shared/types";
import { ok } from "../../domain/shared/types";
import { Product } from "../../domain/store/product";
import { ProductVariant } from "../../domain/store/variant";
import type { ProductRepository } from "../../infrastructure/repos/d1-product-repo";
import type { ProductWithVariants } from "./create-product";

/** Sort keys for the collection/catalog listing (default = store order). */
export const PRODUCT_SORT_KEYS = [
  "default",
  "price_asc",
  "price_desc",
  "newest",
  "name_asc",
] as const;
export type ProductSortKey = (typeof PRODUCT_SORT_KEYS)[number];

export function isProductSortKey(value: unknown): value is ProductSortKey {
  return typeof value === "string" && (PRODUCT_SORT_KEYS as readonly string[]).includes(value);
}

export interface ListProductsInput {
  storeId: EntityId;
  /** Filter to a single category (null/undefined = all). */
  categoryId?: EntityId | null;
  sort?: ProductSortKey;
}

type VariantJson = ReturnType<ProductVariant["toJSON"]>;

export class ListProducts {
  constructor(private readonly productRepo: ProductRepository) {}

  async execute(input: ListProductsInput): Promise<Result<ProductWithVariants[], never>> {
    let products = await this.productRepo.findByStoreId(input.storeId);

    if (input.categoryId) {
      products = products.filter((p) => p.categoryId === input.categoryId);
    }

    switch (input.sort ?? "default") {
      case "price_asc":
        products = [...products].sort((a, b) => a.effectivePrice - b.effectivePrice);
        break;
      case "price_desc":
        products = [...products].sort((a, b) => b.effectivePrice - a.effectivePrice);
        break;
      case "newest":
        products = [...products].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        break;
      case "name_asc":
        products = [...products].sort((a, b) => a.name.localeCompare(b.name, "id"));
        break;
      default:
        break; // keep store order (insertion order)
    }

    const variants = await this.productRepo.findVariantsByProductIds(products.map((p) => p.id));
    const byProduct = new Map<string, VariantJson[]>();
    for (const v of variants) {
      const list = byProduct.get(v.productId as string) ?? [];
      list.push(v.toJSON());
      byProduct.set(v.productId as string, list);
    }
    return ok(products.map((p) => ({ ...p.toJSON(), variants: byProduct.get(p.id as string) ?? [] })));
  }
}
