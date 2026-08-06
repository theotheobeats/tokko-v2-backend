import { describe, it, expect, vi, beforeEach } from "vitest";
import { GetAdminStats } from "../../../src/application/admin/admin-stats";
import {
  SuspendStore,
  UnsuspendStore,
  DeleteAdminStore,
  StoreNotFoundError,
} from "../../../src/application/admin/admin-stores";
import { BanUser, UnbanUser, SetUserRole, UserNotFoundError } from "../../../src/application/admin/admin-users";
import type { StoreRepository } from "../../../src/application/store/store-repo";
import type { OrderRepository } from "../../../src/infrastructure/repos/d1-order-repo";
import type { TicketRepository } from "../../../src/infrastructure/repos/d1-ticket-repo";
import type { ReportRepository } from "../../../src/infrastructure/repos/d1-report-repo";
import type { ProductRepository } from "../../../src/infrastructure/repos/d1-product-repo";
import type { PageRepository } from "../../../src/infrastructure/repos/d1-page-repo";
import { Store } from "../../../src/domain/store/store";
import { BusinessType, Aesthetic } from "../../../src/domain/store/types";
import { createEntityId } from "../../../src/domain/shared/types";

const ownerId = createEntityId();

function makeStore(status: "draft" | "published" = "published") {
  const store = Store.create({
    ownerId,
    name: "Anna Bakery",
    businessType: BusinessType.Food,
    aestheticPreference: Aesthetic.Warm,
    whatsappNumber: "628123456789",
  });
  if (status === "published") store.setProductCount(1);
  return store;
}

// ---------------------------------------------------------------------------
// GetAdminStats
// ---------------------------------------------------------------------------

describe("GetAdminStats", () => {
  it("should aggregate counts across all repos", async () => {
    const stats = await new GetAdminStats(
      {
        counts: vi.fn().mockResolvedValue({ total: 10, admins: 1, banned: 2 }),
        since: vi.fn().mockResolvedValue(3),
      } as never,
      {
        countAll: vi.fn().mockResolvedValue({ total: 5, published: 4, draft: 1, suspended: 1 }),
      } as never,
      {
        countAll: vi.fn().mockResolvedValue({ all: 20, pending: 5, contacted: 5, completed: 10 }),
        sumTotalAll: vi.fn().mockResolvedValue(2_500_000),
        since: vi.fn().mockResolvedValue({ orders: 7, gmv: 700_000 }),
      } as never,
      {
        countByStatus: vi.fn().mockResolvedValue({ open: 3, in_progress: 1, resolved: 2, closed: 9 }),
      } as never,
      {
        countByStatus: vi.fn().mockResolvedValue({ open: 4, reviewing: 1, resolved: 0, dismissed: 2 }),
      } as never,
    ).execute();

    expect(stats.users.total).toBe(10);
    expect(stats.users.new7d).toBe(3);
    expect(stats.stores.suspended).toBe(1);
    expect(stats.orders.gmv).toBe(2_500_000);
    expect(stats.orders.gmv7d).toBe(700_000);
    expect(stats.tickets.open).toBe(3);
    expect(stats.reports.open).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Store moderation
// ---------------------------------------------------------------------------

describe("SuspendStore / UnsuspendStore", () => {
  let store: Store;
  let repo: StoreRepository;

  beforeEach(() => {
    store = makeStore();
    repo = {
      findById: vi.fn().mockResolvedValue(store),
      save: vi.fn().mockResolvedValue(undefined),
    } as never;
  });

  it("should suspend with a reason", async () => {
    const result = await new SuspendStore(repo).execute({ storeId: store.id, reason: "Barang palsu" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.suspendedAt).not.toBeNull();
    }
    expect(store.isSuspended).toBe(true);
    expect(store.suspendedReason).toBe("Barang palsu");
  });

  it("should reject suspending an unknown store", async () => {
    repo = { findById: vi.fn().mockResolvedValue(null) } as never;
    const result = await new SuspendStore(repo).execute({ storeId: createEntityId(), reason: "x" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(StoreNotFoundError);
  });

  it("should unsuspend", async () => {
    store.suspend("review");
    const result = await new UnsuspendStore(repo).execute({ storeId: store.id });
    expect(result.ok).toBe(true);
    expect(store.isSuspended).toBe(false);
    expect(store.suspendedReason).toBeNull();
  });
});

describe("DeleteAdminStore", () => {
  it("should cascade delete products, page, orders and the store", async () => {
    const store = makeStore();
    const productRepo = { deleteByStoreId: vi.fn().mockResolvedValue(undefined) } as never;
    const pageRepo = { deleteByStoreId: vi.fn().mockResolvedValue(undefined) } as never;
    const orderRepo = { deleteByStoreId: vi.fn().mockResolvedValue(undefined) } as never;
    const storeRepo = {
      findById: vi.fn().mockResolvedValue(store),
      delete: vi.fn().mockResolvedValue(undefined),
    } as never;

    const result = await new DeleteAdminStore(storeRepo as StoreRepository, productRepo as ProductRepository, pageRepo as PageRepository, orderRepo as OrderRepository).execute({ storeId: store.id });

    expect(result.ok).toBe(true);
    expect(productRepo.deleteByStoreId).toHaveBeenCalledWith(store.id);
    expect(pageRepo.deleteByStoreId).toHaveBeenCalledWith(store.id);
    expect(orderRepo.deleteByStoreId).toHaveBeenCalledWith(store.id);
    expect(storeRepo.delete).toHaveBeenCalledWith(store.id);
  });
});

// ---------------------------------------------------------------------------
// User management
// ---------------------------------------------------------------------------

describe("BanUser / UnbanUser / SetUserRole", () => {
  const adminUser = {
    id: "u-admin",
    name: "Admin",
    email: "admin@7okko.com",
    emailVerified: true,
    role: "admin",
    banned: false,
    banReason: null,
    banExpires: null,
    image: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const auth = {
    banUser: vi.fn().mockResolvedValue({}),
    unbanUser: vi.fn().mockResolvedValue({}),
    setRole: vi.fn().mockResolvedValue({}),
  };

  it("should ban a user via better-auth", async () => {
    const userRepo = {
      findById: vi.fn().mockResolvedValue({ ...adminUser, id: "u-1", role: "user" }),
    } as never;

    const result = await new BanUser(auth as never, userRepo as never).execute({ userId: "u-1" as never, reason: "spam" });
    expect(result.ok).toBe(true);
    expect(auth.banUser).toHaveBeenCalledWith({ body: { userId: "u-1", banReason: "spam" } });
  });

  it("should set role", async () => {
    const userRepo = {
      findById: vi.fn().mockResolvedValue({ ...adminUser, id: "u-2", role: "user" }),
    } as never;

    const result = await new SetUserRole(auth as never, userRepo as never).execute({ userId: "u-2" as never, role: "admin" });
    expect(result.ok).toBe(true);
    expect(auth.setRole).toHaveBeenCalledWith({ body: { userId: "u-2", role: "admin" } });
  });

  it("should return not-found for unknown users", async () => {
    const userRepo = { findById: vi.fn().mockResolvedValue(null) } as never;
    const result = await new BanUser(auth as never, userRepo as never).execute({ userId: "missing" as never });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(UserNotFoundError);
  });

  it("should unban", async () => {
    const userRepo = {
      findById: vi.fn().mockResolvedValue({ ...adminUser, id: "u-3", role: "user", banned: true }),
    } as never;

    const result = await new UnbanUser(auth as never, userRepo as never).execute({ userId: "u-3" as never });
    expect(result.ok).toBe(true);
    expect(auth.unbanUser).toHaveBeenCalledWith({ body: { userId: "u-3" } });
  });
});
