/**
 * D1 Product Repository.
 */

import { eq, and, inArray } from "drizzle-orm";
import type { EntityId } from "../../domain/shared/types";
import { Product, type ProductProps } from "../../domain/store/product";
import { ProductVariant } from "../../domain/store/variant";
import type { DbClient } from "../db/drizzle";
import { products, productVariants } from "../db/schema";

export interface ProductRepository {
  findById(id: EntityId): Promise<Product | null>;
  findByStoreId(storeId: EntityId): Promise<Product[]>;
  findByStoreSlug(storeId: EntityId, slug: string): Promise<Product | null>;
  findVariantsByProductIds(productIds: EntityId[]): Promise<ProductVariant[]>;
  replaceVariants(productId: EntityId, variants: ProductVariant[]): Promise<void>;
  deleteVariantsByProductId(productId: EntityId): Promise<void>;
  save(product: Product): Promise<void>;
  delete(id: EntityId): Promise<void>;
  deleteByStoreId(storeId: EntityId): Promise<void>;
  countByStoreId(storeId: EntityId): Promise<number>;
}

function parseImages(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
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

  async findByStoreSlug(storeId: EntityId, slug: string): Promise<Product | null> {
    const row = await this.db
      .select()
      .from(products)
      .where(and(eq(products.storeId, storeId as string), eq(products.slug, slug)))
      .get();
    return row ? this._toDomain(row) : null;
  }

  async findVariantsByProductIds(productIds: EntityId[]): Promise<ProductVariant[]> {
    if (productIds.length === 0) return [];
    const rows = await this.db
      .select()
      .from(productVariants)
      .where(inArray(productVariants.productId, productIds.map((id) => id as string)))
      .orderBy(productVariants.sortOrder)
      .all();
    return rows.map((r) =>
      ProductVariant.from({
        id: r.id as EntityId,
        productId: r.productId as EntityId,
        name: r.name,
        price: r.price,
        sortOrder: r.sortOrder,
      }),
    );
  }

  /** Replace a product's variants (variant list is owned by the product). */
  async replaceVariants(productId: EntityId, variants: ProductVariant[]): Promise<void> {
    await this.deleteVariantsByProductId(productId);
    if (variants.length === 0) return;
    await this.db.insert(productVariants).values(
      variants.map((v) => ({
        id: v.id as string,
        productId: productId as string,
        name: v.name,
        price: v.price,
        sortOrder: v.sortOrder,
      })),
    );
  }

  async deleteVariantsByProductId(productId: EntityId): Promise<void> {
    await this.db.delete(productVariants).where(eq(productVariants.productId, productId as string));
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
    await this.deleteVariantsByProductId(id);
    await this.db.delete(products).where(eq(products.id, id as string));
  }

  /** Admin: remove every product of a store (store deletion cascade). */
  async deleteByStoreId(storeId: EntityId): Promise<void> {
    const storeProducts = await this.findByStoreId(storeId);
    await this.db.delete(productVariants).where(
      inArray(
        productVariants.productId,
        storeProducts.map((p) => p.id as string),
      ),
    );
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
      images: parseImages(row.images),
      salePrice: row.salePrice,
      slug: row.slug,
      categoryId: (row.categoryId as EntityId | null) ?? null,
      stock: row.stock,
      isAvailable: row.isAvailable === 1,
      type: (row.type ?? "product") as Product["type"],
      createdAt: row.createdAt,
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
      images: props.images.length > 0 ? JSON.stringify(props.images) : null,
      salePrice: props.salePrice,
      slug: props.slug,
      categoryId: props.categoryId as string | null,
      stock: props.stock,
      isAvailable: props.isAvailable ? 1 : 0,
      type: props.type,
    };
  }
}
