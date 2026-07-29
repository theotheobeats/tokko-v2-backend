/**
 * D1 Store Repository — implements StoreRepository using Drizzle + D1.
 */

import { eq } from "drizzle-orm";
import type { StoreRepository } from "../../application/store/store-repo";
import type { EntityId } from "../../domain/shared/types";
import { Store, type StoreProps } from "../../domain/store/store";
import type { DbClient } from "../db/drizzle";
import { stores } from "../db/schema";

export class D1StoreRepository implements StoreRepository {
  constructor(private readonly db: DbClient) {}

  async findById(id: EntityId): Promise<Store | null> {
    const row = await this.db
      .select()
      .from(stores)
      .where(eq(stores.id, id as string))
      .get();

    if (!row) return null;
    return this._toDomain(row);
  }

  async findBySubdomain(subdomain: string): Promise<Store | null> {
    const row = await this.db
      .select()
      .from(stores)
      .where(eq(stores.subdomain, subdomain))
      .get();

    if (!row) return null;
    return this._toDomain(row);
  }

  async findByOwnerId(ownerId: EntityId): Promise<Store | null> {
    const row = await this.db
      .select()
      .from(stores)
      .where(eq(stores.ownerId, ownerId as string))
      .get();

    if (!row) return null;
    return this._toDomain(row);
  }

  async save(store: Store): Promise<void> {
    const data = this._toRow(store.toJSON());
    const existing = await this.findById(store.id);

    if (existing) {
      await this.db.update(stores)
        .set(data)
        .where(eq(stores.id, store.id as string));
    } else {
      await this.db.insert(stores).values(data);
    }
  }

  async delete(id: EntityId): Promise<void> {
    await this.db.delete(stores).where(eq(stores.id, id as string));
  }

  /** Count products belonging to this store (for publish invariant) */
  async countProducts(storeId: EntityId): Promise<number> {
    const { products } = await import("../db/schema");
    const { count } = await import("drizzle-orm");
    const result = await this.db
      .select({ count: count() })
      .from(products)
      .where(eq(products.storeId, storeId as string))
      .get();
    return result?.count ?? 0;
  }

  // -----------------------------------------------------------------------
  // Mapping helpers
  // -----------------------------------------------------------------------

  private _toDomain(row: typeof stores.$inferSelect): Store {
    return Store.from({
      id: row.id as EntityId,
      ownerId: row.ownerId as EntityId,
      name: row.name,
      subdomain: row.subdomain,
      description: row.description,
      businessType: row.businessType as StoreProps["businessType"],
      aestheticPreference: row.aestheticPreference as StoreProps["aestheticPreference"],
      whatsappNumber: row.whatsappNumber,
      status: row.status as StoreProps["status"],
      heroImageUrl: row.heroImageUrl,
      productCount: 0, // populated separately via countProducts()
    });
  }

  private _toRow(props: StoreProps) {
    return {
      id: props.id as string,
      ownerId: props.ownerId as string,
      name: props.name,
      subdomain: props.subdomain,
      description: props.description,
      businessType: props.businessType,
      aestheticPreference: props.aestheticPreference,
      whatsappNumber: props.whatsappNumber,
      status: props.status,
      heroImageUrl: props.heroImageUrl,
    };
  }
}
