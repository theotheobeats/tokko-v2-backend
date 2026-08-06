/**
 * D1 Product Repository.
 */

import { eq, and } from "drizzle-orm";
import type { EntityId } from "../../domain/shared/types";
import { Product, type ProductProps } from "../../domain/store/product";
import type { DbClient } from "../db/drizzle";
import { products } from "../db/schema";

export interface ProductRepository {
  findById(id: EntityId): Promise<Product | null>;
  findByStoreId(storeId: EntityId): Promise<Product[]>;
  save(product: Product): Promise<void>;
  delete(id: EntityId): Promise<void>;
  deleteByStoreId(storeId: EntityId): Promise<void>;
  countByStoreId(storeId: EntityId): Promise<number>;
}

export class D1ProductRepository implements ProductRepository {
  constructor(private readonly db: DbClient) {}

  async findById(id: EntityId): Promise<Product | null> {
    const row = await this.db
      .select()
      .from(products)
      .where(eq(products.id, id as string))
      .get();
    return row ? this._toDomain(row) : null;
  }

  async findByStoreId(storeId: EntityId): Promise<Product[]> {
    const rows = await this.db
      .select()
      .from(products)
      .where(eq(products.storeId, storeId as string))
      .all();
    return rows.map((r) => this._toDomain(r));
  }

  async save(product: Product): Promise<void> {
    const data = this._toRow(product.toJSON());
    const existing = await this.findById(product.id);

    if (existing) {
      await this.db.update(products)
        .set(data)
        .where(eq(products.id, product.id as string));
    } else {
      await this.db.insert(products).values(data);
    }
  }

  async delete(id: EntityId): Promise<void> {
    await this.db.delete(products).where(eq(products.id, id as string));
  }

  /** Admin: remove every product of a store (store deletion cascade). */
  async deleteByStoreId(storeId: EntityId): Promise<void> {
    await this.db.delete(products).where(eq(products.storeId, storeId as string));
  }

  async countByStoreId(storeId: EntityId): Promise<number> {
    const { count } = await import("drizzle-orm");
    const result = await this.db
      .select({ count: count() })
      .from(products)
      .where(eq(products.storeId, storeId as string))
      .get();
    return result?.count ?? 0;
  }

  private _toDomain(row: typeof products.$inferSelect): Product {
    return Product.from({
      id: row.id as EntityId,
      storeId: row.storeId as EntityId,
      name: row.name,
      description: row.description,
      price: row.price,
      imageUrl: row.imageUrl,
      isAvailable: row.isAvailable === 1,
      type: (row.type ?? "product") as Product["type"],
    });
  }

  private _toRow(props: ProductProps) {
    return {
      id: props.id as string,
      storeId: props.storeId as string,
      name: props.name,
      description: props.description,
      price: props.price,
      imageUrl: props.imageUrl,
      isAvailable: props.isAvailable ? 1 : 0,
      type: props.type,
    };
  }
}
