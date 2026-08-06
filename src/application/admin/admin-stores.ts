/**
 * Admin — store moderation use cases.
 */

import type { EntityId } from "../../domain/shared/types";
import type { Result } from "../../domain/shared/types";
import { ok, err } from "../../domain/shared/types";
import type { Store } from "../../domain/store/store";
import type { StoreRepository, StoreListFilters } from "../store/store-repo";
import type { D1AdminUserRepository } from "../../infrastructure/repos/d1-admin-user-repo";
import type { ProductRepository } from "../../infrastructure/repos/d1-product-repo";
import type { PageRepository } from "../../infrastructure/repos/d1-page-repo";
import type { OrderRepository } from "../../infrastructure/repos/d1-order-repo";
import { serializePage } from "../page/render-section";

export class StoreNotFoundError extends Error {
  code = "STORE_NOT_FOUND";
  constructor() {
    super("Toko tidak ditemukan");
  }
}

// ---------------------------------------------------------------------------
// ListAdminStores
// ---------------------------------------------------------------------------

export class ListAdminStores {
  constructor(private readonly storeRepo: StoreRepository) {}

  async execute(input: StoreListFilters) {
    return this.storeRepo.listAll(input);
  }
}

// ---------------------------------------------------------------------------
// GetAdminStore — store + owner + products + page + orders
// ---------------------------------------------------------------------------

export class GetAdminStore {
  constructor(
    private readonly storeRepo: StoreRepository,
    private readonly userRepo: D1AdminUserRepository,
    private readonly productRepo: ProductRepository,
    private readonly pageRepo: PageRepository,
    private readonly orderRepo: OrderRepository,
  ) {}

  async execute(input: { storeId: EntityId }): Promise<
    Result<
      {
        store: ReturnType<GetAdminStore["_storeJson"]>;
        owner: { id: string; name: string; email: string; banned: boolean } | null;
        products: { id: string; name: string; price: number; isAvailable: boolean; type: string }[];
        page: { sections: unknown[]; theme: Record<string, string> | null } | null;
        pages: { id: string; slug: string; title: string | null }[];
        orders: { all: number; pending: number; contacted: number; completed: number };
      },
      StoreNotFoundError
    >
  > {
    const store = await this.storeRepo.findById(input.storeId);
    if (!store) return err(new StoreNotFoundError());

    const [owner, products, homePage, pages, orderCounts] = await Promise.all([
      this.userRepo.findById(store.ownerId),
      this.productRepo.findByStoreId(store.id),
      this.pageRepo.findByStoreId(store.id),
      this.pageRepo.listByStoreId(store.id),
      this.orderRepo.countByStoreId(store.id),
    ]);

    return ok({
      store: this._storeJson(store),
      owner: owner ? { id: owner.id, name: owner.name, email: owner.email, banned: owner.banned } : null,
      products: products.map((p) => ({
        id: p.id,
        name: p.name,
        price: p.price,
        isAvailable: p.isAvailable,
        type: p.type,
      })),
      page: homePage ? serializePage(homePage, store.designTokens) : null,
      pages: pages.map((p) => ({ id: p.id, slug: p.slug, title: p.title })),
      orders: orderCounts,
    });
  }

  private _storeJson(store: Store) {
    return {
      id: store.id,
      ownerId: store.ownerId,
      name: store.name,
      subdomain: store.subdomain,
      description: store.description,
      businessType: store.businessType,
      aestheticPreference: store.aestheticPreference,
      whatsappNumber: store.whatsappNumber,
      status: store.status,
      heroImageUrl: store.heroImageUrl,
      suspendedAt: store.suspendedAt,
      suspendedReason: store.suspendedReason,
      productCount: store.productCount,
      createdAt: store.toJSON().createdAt,
    };
  }
}

// ---------------------------------------------------------------------------
// SuspendStore / UnsuspendStore
// ---------------------------------------------------------------------------

export class SuspendStore {
  constructor(private readonly storeRepo: StoreRepository) {}

  async execute(input: { storeId: EntityId; reason: string }): Promise<Result<{ storeId: EntityId; suspendedAt: string }, StoreNotFoundError>> {
    const store = await this.storeRepo.findById(input.storeId);
    if (!store) return err(new StoreNotFoundError());
    store.suspend(input.reason);
    await this.storeRepo.save(store);
    return ok({ storeId: store.id, suspendedAt: store.suspendedAt! });
  }
}

export class UnsuspendStore {
  constructor(private readonly storeRepo: StoreRepository) {}

  async execute(input: { storeId: EntityId }): Promise<Result<{ storeId: EntityId }, StoreNotFoundError>> {
    const store = await this.storeRepo.findById(input.storeId);
    if (!store) return err(new StoreNotFoundError());
    if (store.isSuspended) {
      store.unsuspend();
      await this.storeRepo.save(store);
    }
    return ok({ storeId: store.id });
  }
}

// ---------------------------------------------------------------------------
// DeleteAdminStore — cascades products + page/sections + orders + store
// ---------------------------------------------------------------------------

export class DeleteAdminStore {
  constructor(
    private readonly storeRepo: StoreRepository,
    private readonly productRepo: ProductRepository,
    private readonly pageRepo: PageRepository,
    private readonly orderRepo: OrderRepository,
  ) {}

  async execute(input: { storeId: EntityId }): Promise<Result<{ storeId: EntityId }, StoreNotFoundError>> {
    const store = await this.storeRepo.findById(input.storeId);
    if (!store) return err(new StoreNotFoundError());

    await Promise.all([
      this.productRepo.deleteByStoreId(store.id),
      this.pageRepo.deleteByStoreId(store.id),
      this.orderRepo.deleteByStoreId(store.id),
    ]);
    await this.storeRepo.delete(store.id);
    return ok({ storeId: store.id });
  }
}
