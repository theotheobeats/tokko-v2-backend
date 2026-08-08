/**
 * UpdateProduct use case.
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
import type { CreateVariantInput, ProductWithVariants } from "./create-product";

export interface UpdateProductInput {
  productId: EntityId;
  name?: string;
  price?: number;
  description?: string | null;
  imageUrl?: string | null;
  images?: string[];
  salePrice?: number | null;
  slug?: string | null;
  categoryId?: EntityId | null;
  stock?: number | null;
  weight?: number | null;
  isAvailable?: boolean;
  type?: ProductTypeT;
  variants?: CreateVariantInput[] | null;
}

export interface UpdateProductError {
  code: "NOT_FOUND" | "VALIDATION" | "CATEGORY_NOT_FOUND" | "SLUG_TAKEN";
  message: string;
  field?: string;
}

export class UpdateProduct {
  constructor(
    private readonly productRepo: ProductRepository,
    private readonly categoryRepo?: CategoryRepository,
  ) {}

  async execute(input: UpdateProductInput): Promise<Result<ProductWithVariants, UpdateProductError>> {
    const product = await this.productRepo.findById(input.productId);
    if (!product) {
      return err({ code: "NOT_FOUND", message: "Produk tidak ditemukan." });
    }

    // Validate price if provided
    if (input.price !== undefined) {
      if (input.price < 0 || !Number.isInteger(input.price)) {
        return err({ code: "VALIDATION", message: "Harga harus >= 0.", field: "price" });
      }
      product.updatePrice(input.price);
    }

    // Validate sale price if provided
    if (input.salePrice !== undefined) {
      if (input.salePrice !== null && (input.salePrice < 0 || !Number.isInteger(input.salePrice))) {
        return err({ code: "VALIDATION", message: "Harga promo harus >= 0.", field: "salePrice" });
      }
    }

    // Validate stock if provided
    if (input.stock !== undefined) {
      if (input.stock !== null && (input.stock < 0 || !Number.isInteger(input.stock))) {
        return err({ code: "VALIDATION", message: "Stok harus >= 0.", field: "stock" });
      }
    }

    // Validate weight if provided
    if (input.weight !== undefined) {
      if (input.weight !== null && (input.weight < 1 || !Number.isInteger(input.weight))) {
        return err({ code: "VALIDATION", message: "Berat minimal 1 gram.", field: "weight" });
      }
    }

    // Validate type if provided
    if (input.type !== undefined && !isValidProductType(input.type)) {
      return err({ code: "VALIDATION", message: "Tipe produk tidak valid.", field: "type" });
    }

    // Validate variants
    if (input.variants?.some((v) => !v.name.trim())) {
      return err({ code: "VALIDATION", message: "Nama varian wajib diisi.", field: "variants" });
    }

    // Category must belong to the same store
    if (input.categoryId !== undefined && input.categoryId !== null) {
      const category = await this.categoryRepo?.findById(input.categoryId);
      if (!category || category.storeId !== product.storeId) {
        return err({ code: "CATEGORY_NOT_FOUND", message: "Kategori tidak ditemukan.", field: "categoryId" });
      }
    }

    // Slug: explicit (validated + uniqueness), or auto-generate when the
    // product never had one (backfills legacy products on first edit).
    let resolvedSlug: string | undefined;
    if (input.slug !== undefined && input.slug !== null) {
      const taken = await this.productRepo.findByStoreSlug(product.storeId, input.slug);
      if (taken && taken.id !== product.id) {
        return err({ code: "SLUG_TAKEN", message: "Slug sudah dipakai produk lain.", field: "slug" });
      }
      resolvedSlug = input.slug;
    } else if (product.slug === null) {
      resolvedSlug = await this.uniqueSlug(product.storeId, input.name ?? product.name, product.id);
    }

    // Update details
    product.updateDetails({
      name: input.name,
      description: input.description,
      imageUrl: input.imageUrl,
      images: input.images,
      salePrice: input.salePrice,
      slug: resolvedSlug,
      categoryId: input.categoryId,
      stock: input.stock,
      weight: input.weight,
      type: input.type,
    });

    // Toggle availability
    if (input.isAvailable !== undefined && input.isAvailable !== product.isAvailable) {
      product.toggleAvailability();
    }

    await this.productRepo.save(product);

    // Replace variants when provided
    let variants: ReturnType<ProductVariant["toJSON"]>[] = [];
    if (input.variants !== undefined && input.variants !== null) {
      const next = input.variants.map((v, i) =>
        ProductVariant.create({ productId: product.id, name: v.name, price: v.price ?? null, sortOrder: i }),
      );
      await this.productRepo.replaceVariants(product.id, next);
      variants = next.map((v) => v.toJSON());
    } else {
      variants = (await this.productRepo.findVariantsByProductIds([product.id])).map((v) => v.toJSON());
    }

    return ok({ ...product.toJSON(), variants });
  }

  /** First free slug for `base`, skipping `excludeId` (the product itself). */
  private async uniqueSlug(storeId: EntityId, name: string, excludeId: EntityId): Promise<string> {
    const base = slugify(name) || "produk";
    let candidate = base;
    let n = 2;
    for (;;) {
      const existing = await this.productRepo.findByStoreSlug(storeId, candidate);
      if (!existing || existing.id === excludeId) return candidate;
      candidate = `${base}-${n++}`;
    }
  }
}
