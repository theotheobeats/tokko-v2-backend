/**
 * CreateProduct use case.
 */

import type { EntityId, ProductType as ProductTypeT } from "../../domain/shared/types";
import type { Result } from "../../domain/shared/types";
import { ok, err } from "../../domain/shared/types";
import { Product } from "../../domain/store/product";
import { ProductVariant } from "../../domain/store/variant";
import { slugify } from "../../domain/store/rules";
import { isValidProductType } from "../../domain/shared/types";
import type { ProductRepository } from "../../infrastructure/repos/d1-product-repo";
import type { CategoryRepository } from "../../infrastructure/repos/d1-category-repo";

export interface CreateVariantInput {
  name: string;
  price?: number | null;
}

export interface CreateProductInput {
  storeId: EntityId;
  name: string;
  price: number;
  description?: string;
  imageUrl?: string;
  images?: string[];
  salePrice?: number | null;
  slug?: string | null;
  categoryId?: EntityId | null;
  stock?: number | null;
  type?: ProductTypeT;
  variants?: CreateVariantInput[];
}

export interface CreateProductError {
  code: "VALIDATION" | "PRODUCT_LIMIT_REACHED" | "CATEGORY_NOT_FOUND" | "SLUG_TAKEN";
  message: string;
  field?: string;
}

/** Product JSON with its variants embedded (what the API returns). */
export type ProductWithVariants = ReturnType<Product["toJSON"]> & {
  variants: ReturnType<ProductVariant["toJSON"]>[];
};

export class CreateProduct {
  constructor(
    private readonly productRepo: ProductRepository,
    private readonly categoryRepo?: CategoryRepository,
  ) {}

  async execute(input: CreateProductInput): Promise<Result<ProductWithVariants, CreateProductError>> {
    // Validate
    if (!input.name.trim()) {
      return err({ code: "VALIDATION", message: "Nama produk wajib diisi.", field: "name" });
    }
    if (input.price < 0 || !Number.isInteger(input.price)) {
      return err({ code: "VALIDATION", message: "Harga harus >= 0.", field: "price" });
    }
    if (input.salePrice !== undefined && input.salePrice !== null && (input.salePrice < 0 || !Number.isInteger(input.salePrice))) {
      return err({ code: "VALIDATION", message: "Harga promo harus >= 0.", field: "salePrice" });
    }
    if (input.stock !== undefined && input.stock !== null && (input.stock < 0 || !Number.isInteger(input.stock))) {
      return err({ code: "VALIDATION", message: "Stok harus >= 0.", field: "stock" });
    }
    if (input.type !== undefined && !isValidProductType(input.type)) {
      return err({ code: "VALIDATION", message: "Tipe produk tidak valid.", field: "type" });
    }
    if (input.variants?.some((v) => !v.name.trim())) {
      return err({ code: "VALIDATION", message: "Nama varian wajib diisi.", field: "variants" });
    }

    // Category must belong to this store
    if (input.categoryId) {
      const category = await this.categoryRepo?.findById(input.categoryId);
      if (!category || category.storeId !== input.storeId) {
        return err({ code: "CATEGORY_NOT_FOUND", message: "Kategori tidak ditemukan.", field: "categoryId" });
      }
    }

    // Check limit
    const count = await this.productRepo.countByStoreId(input.storeId);
    if (count >= 20) {
      return err({ code: "PRODUCT_LIMIT_REACHED", message: "Maksimal 20 produk per toko." });
    }

    // Slug: explicit (validated) or auto-generated from the name
    let slug: string | null = null;
    if (input.slug) {
      const taken = await this.productRepo.findByStoreSlug(input.storeId, input.slug);
      if (taken) return err({ code: "SLUG_TAKEN", message: "Slug sudah dipakai produk lain.", field: "slug" });
      slug = input.slug;
    } else {
      slug = await this.uniqueSlug(input.storeId, input.name);
    }

    // Create
    const product = Product.create({
      storeId: input.storeId,
      name: input.name,
      price: input.price,
      description: input.description,
      imageUrl: input.imageUrl,
      images: input.images,
      salePrice: input.salePrice,
      slug,
      categoryId: input.categoryId,
      stock: input.stock,
      type: input.type,
    });

    const variants = (input.variants ?? []).map((v, i) =>
      ProductVariant.create({ productId: product.id, name: v.name, price: v.price ?? null, sortOrder: i }),
    );

    await this.productRepo.save(product);
    if (variants.length > 0) {
      await this.productRepo.replaceVariants(product.id, variants);
    }
    return ok({ ...product.toJSON(), variants: variants.map((v) => v.toJSON()) });
  }

  /** First free slug for `base`, appending -2, -3, … when taken. */
  private async uniqueSlug(storeId: EntityId, name: string): Promise<string> {
    const base = slugify(name) || "produk";
    let candidate = base;
    let n = 2;
    for (;;) {
      const existing = await this.productRepo.findByStoreSlug(storeId, candidate);
      if (!existing) return candidate;
      candidate = `${base}-${n++}`;
    }
  }
}
