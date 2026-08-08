/**
 * Product category use cases — CRUD for a store's product categories.
 */

import type { EntityId } from "../../domain/shared/types";
import type { Result } from "../../domain/shared/types";
import { ok, err } from "../../domain/shared/types";
import { ProductCategory } from "../../domain/store/category";
import type { CategoryRepository } from "../../infrastructure/repos/d1-category-repo";

export interface CategoryError {
  code: "VALIDATION" | "NOT_FOUND" | "SLUG_TAKEN";
  message: string;
  field?: string;
}

function slugifyName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").replace(/-+/g, "-").replace(/^-+|-+$/g, "");
}

export class ListCategories {
  constructor(private readonly categoryRepo: CategoryRepository) {}

  async execute(input: { storeId: EntityId }): Promise<Result<ReturnType<ProductCategory["toJSON"]>[], never>> {
    const categories = await this.categoryRepo.findByStoreId(input.storeId);
    return ok(categories.map((c) => c.toJSON()));
  }
}

export class CreateCategory {
  constructor(private readonly categoryRepo: CategoryRepository) {}

  async execute(input: { storeId: EntityId; name: string }): Promise<Result<ReturnType<ProductCategory["toJSON"]>, CategoryError>> {
    if (!input.name.trim()) {
      return err({ code: "VALIDATION", message: "Nama kategori wajib diisi.", field: "name" });
    }

    const base = slugifyName(input.name) || "kategori";
    let slug = base;
    let n = 2;
    for (;;) {
      const existing = await this.categoryRepo.findByStoreSlug(input.storeId, slug);
      if (!existing) break;
      slug = `${base}-${n++}`;
    }

    const category = ProductCategory.create({ storeId: input.storeId, name: input.name, slug });
    await this.categoryRepo.save(category);
    return ok(category.toJSON());
  }
}

export class UpdateCategory {
  constructor(private readonly categoryRepo: CategoryRepository) {}

  async execute(input: { categoryId: EntityId; name: string }): Promise<Result<ReturnType<ProductCategory["toJSON"]>, CategoryError>> {
    const category = await this.categoryRepo.findById(input.categoryId);
    if (!category) {
      return err({ code: "NOT_FOUND", message: "Kategori tidak ditemukan." });
    }
    if (!input.name.trim()) {
      return err({ code: "VALIDATION", message: "Nama kategori wajib diisi.", field: "name" });
    }
    category.rename(input.name);
    await this.categoryRepo.save(category);
    return ok(category.toJSON());
  }
}

export class DeleteCategory {
  constructor(private readonly categoryRepo: CategoryRepository) {}

  async execute(input: { categoryId: EntityId }): Promise<Result<{ success: true }, CategoryError>> {
    const category = await this.categoryRepo.findById(input.categoryId);
    if (!category) {
      return err({ code: "NOT_FOUND", message: "Kategori tidak ditemukan." });
    }
    await this.categoryRepo.delete(input.categoryId);
    return ok({ success: true });
  }
}
