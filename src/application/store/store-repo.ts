/**
 * Store repository interface.
 * Application layer depends on this abstraction — not on D1/Drizzle.
 */

import type { EntityId } from "../../domain/shared/types";
import type { Store, StoreProps } from "../../domain/store/store";

export interface StoreRepository {
  findById(id: EntityId): Promise<Store | null>;
  findBySubdomain(subdomain: string): Promise<Store | null>;
  findByOwnerId(ownerId: EntityId): Promise<Store | null>;
  save(store: Store): Promise<void>;
  delete(id: EntityId): Promise<void>;
  countProducts(storeId: EntityId): Promise<number>;
}
