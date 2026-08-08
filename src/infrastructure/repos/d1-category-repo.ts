/**
 * D1 Product Category Repository.
 */

import { eq, and } from "drizzle-orm";
import type { EntityId } from "../../domain/shared/types";
import { ProductCategory } from "../../domain/store/category";
import type { DbClient } from "../db/drizzle";
import { productCategories } from "../db/schema";

export interface CategoryRepository {
  findById(id: EntityId): Promise<ProductCategory | null>;
  findByStoreId(storeId: EntityId): Promise<ProductCategory[]>;
  findByStoreSlug(storeId: EntityId, slug: string): Promise<ProductCategory | null>;
  save(category: ProductCategory): Promise<void>;
  delete(id: EntityId): Promise<void>;
}

export class D1CategoryRepository implements CategoryRepository {
  constructor(private readonly db: DbClient) {}

  async findById(id: EntityId): Promise<ProductCategory | null> {
    const row = await this.db
      .select()
      .from(productCategories)
      .where(eq(productCategories.id, id as string))
      .get();
    return row ? this._toDomain(row) : null;
  }

  async findByStoreId(storeId: EntityId): Promise<ProductCategory[]> {
    const rows = await this.db
      .select()
      .from(productCategories)
      .where(eq(productCategories.storeId, storeId as string))
      .orderBy(productCategories.name)
      .all();
    return rows.map((r) => this._toDomain(r));
  }

  async findByStoreSlug(storeId: EntityId, slug: string): Promise<ProductCategory | null> {
    const row = await this.db
      .select()
      .from(productCategories)
      .where(and(eq(productCategories.storeId, storeId as string), eq(productCategories.slug, slug)))
      .get();
    return row ? this._toDomain(row) : null;
  }

  async save(category: ProductCategory): Promise<void> {
    const data = {
      id: category.id as string,
      storeId: category.storeId as string,
      name: category.name,
      slug: category.slug,
    };
    const existing = await this.findById(category.id);
    if (existing) {
      await this.db.update(productCategories).set(data).where(eq(productCategories.id, category.id as string));
    } else {
      await this.db.insert(productCategories).values(data);
    }
  }

  async delete(id: EntityId): Promise<void> {
    await this.db.delete(productCategories).where(eq(productCategories.id, id as string));
  }

  private _toDomain(row: typeof productCategories.$inferSelect): ProductCategory {
    return ProductCategory.from({
      id: row.id as EntityId,
      storeId: row.storeId as EntityId,
      name: row.name,
      slug: row.slug,
    });
  }
}
