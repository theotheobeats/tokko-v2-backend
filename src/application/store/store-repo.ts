/**
 * Store repository interface.
 * Application layer depends on this abstraction — not on D1/Drizzle.
 */

import type { EntityId } from "../../domain/shared/types";
import type { Store, StoreProps } from "../../domain/store/store";
import type { StoreStatus } from "../../domain/store/types";

export interface StoreListFilters {
  status?: StoreStatus;
  /** Only suspended stores. */
  suspended?: boolean;
  /** Search name / subdomain. */
  q?: string;
  limit?: number;
  offset?: number;
}

export interface StoreRepository {
  findById(id: EntityId): Promise<Store | null>;
  findBySubdomain(subdomain: string): Promise<Store | null>;
  findByOwnerId(ownerId: EntityId): Promise<Store | null>;
  /** Settlement webhook attribution: find the store owning this SingaPay sub-account. */
  findBySingapayAccountId(accountId: string): Promise<Store | null>;
  save(store: Store): Promise<void>;
  delete(id: EntityId): Promise<void>;
  countProducts(storeId: EntityId): Promise<number>;
  /** How many products ship (type "product") — origin required only when > 0. */
  countPhysicalProducts(storeId: EntityId): Promise<number>;
  /** Publish invariant: physical products (type "product") missing weight/dimensions. */
  countPhysicalProductsMissingShipping(storeId: EntityId): Promise<number>;
  /** Admin: list stores across all owners. */
  listAll(filters?: StoreListFilters): Promise<{ stores: Store[]; total: number }>;
  /** Admin: aggregate counts for the dashboard. */
  countAll(): Promise<{ total: number; published: number; draft: number; suspended: number }>;
  /** Trial lifecycle: all stores with a trial deadline set (remind/pause logic runs in the use case). */
  listByTrialSet(): Promise<Store[]>;
  /** Trial lifecycle: stores paused before the given ISO cutoff (archive job). */
  listPausedBefore(cutoffIso: string): Promise<Store[]>;
}
