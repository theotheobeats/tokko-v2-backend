/**
 * Admin — user management use cases.
 *
 * Reads go through D1AdminUserRepository. Mutations (ban / unban / role)
 * go through better-auth's admin API so session + ban state stay consistent
 * (banned users get their sessions revoked by the plugin).
 */

import type { EntityId } from "../../domain/shared/types";
import type { Result } from "../../domain/shared/types";
import { ok, err } from "../../domain/shared/types";
import type { D1AdminUserRepository, AdminUserRow } from "../../infrastructure/repos/d1-admin-user-repo";
import type { StoreRepository } from "../store/store-repo";
import type { OrderRepository } from "../../infrastructure/repos/d1-order-repo";

/** The subset of better-auth's auth.api the admin user use cases need. */
export interface AuthAdminApi {
  banUser(input: { body: { userId: string; banReason?: string; banExpiresIn?: number } }): Promise<unknown>;
  unbanUser(input: { body: { userId: string } }): Promise<unknown>;
  // better-auth types role as string | string[] (admin plugin roles).
  setRole(input: { body: { userId: string; role: string | string[] } }): Promise<unknown>;
}

export class UserNotFoundError extends Error {
  code = "USER_NOT_FOUND";
  constructor() {
    super("User tidak ditemukan");
  }
}

// ---------------------------------------------------------------------------
// ListAdminUsers
// ---------------------------------------------------------------------------

export class ListAdminUsers {
  constructor(private readonly userRepo: D1AdminUserRepository) {}

  async execute(input: { q?: string; role?: string; banned?: boolean; limit?: number; offset?: number }) {
    return this.userRepo.list(input);
  }
}

// ---------------------------------------------------------------------------
// GetAdminUser — user + their store + order counts
// ---------------------------------------------------------------------------

export class GetAdminUser {
  constructor(
    private readonly userRepo: D1AdminUserRepository,
    private readonly storeRepo: StoreRepository,
    private readonly orderRepo: OrderRepository,
  ) {}

  async execute(input: { userId: EntityId }): Promise<
    Result<
      {
        user: AdminUserRow;
        store: { id: string; name: string; subdomain: string; status: string; suspendedAt: string | null } | null;
        orders: { all: number; pending: number; contacted: number; completed: number };
      },
      UserNotFoundError
    >
  > {
    const user = await this.userRepo.findById(input.userId);
    if (!user) return err(new UserNotFoundError());

    const store = await this.storeRepo.findByOwnerId(input.userId);
    const orders = store ? await this.orderRepo.countByStoreId(store.id) : { all: 0, pending: 0, contacted: 0, completed: 0 };

    return ok({
      user,
      store: store
        ? {
            id: store.id,
            name: store.name,
            subdomain: store.subdomain,
            status: store.status,
            suspendedAt: store.suspendedAt,
          }
        : null,
      orders,
    });
  }
}

// ---------------------------------------------------------------------------
// BanUser / UnbanUser / SetUserRole
// ---------------------------------------------------------------------------

export class BanUser {
  constructor(
    private readonly auth: AuthAdminApi,
    private readonly userRepo: D1AdminUserRepository,
  ) {}

  async execute(input: { userId: EntityId; reason?: string }): Promise<Result<AdminUserRow, UserNotFoundError>> {
    const user = await this.userRepo.findById(input.userId);
    if (!user) return err(new UserNotFoundError());
    await this.auth.banUser({ body: { userId: user.id, ...(input.reason ? { banReason: input.reason } : {}) } });
    const updated = await this.userRepo.findById(input.userId);
    return ok(updated!);
  }
}

export class UnbanUser {
  constructor(
    private readonly auth: AuthAdminApi,
    private readonly userRepo: D1AdminUserRepository,
  ) {}

  async execute(input: { userId: EntityId }): Promise<Result<AdminUserRow, UserNotFoundError>> {
    const user = await this.userRepo.findById(input.userId);
    if (!user) return err(new UserNotFoundError());
    await this.auth.unbanUser({ body: { userId: user.id } });
    const updated = await this.userRepo.findById(input.userId);
    return ok(updated!);
  }
}

export class SetUserRole {
  constructor(
    private readonly auth: AuthAdminApi,
    private readonly userRepo: D1AdminUserRepository,
  ) {}

  async execute(input: { userId: EntityId; role: string }): Promise<Result<AdminUserRow, UserNotFoundError>> {
    const user = await this.userRepo.findById(input.userId);
    if (!user) return err(new UserNotFoundError());
    await this.auth.setRole({ body: { userId: user.id, role: input.role } });
    const updated = await this.userRepo.findById(input.userId);
    return ok(updated!);
  }
}
