/**
 * Admin — cross-store order queries + consent audit + admin log use cases.
 */

import type { EntityId } from "../../domain/shared/types";
import type { OrderRepository } from "../../infrastructure/repos/d1-order-repo";
import type { D1ConsentRepository } from "../../infrastructure/repos/d1-consent-repo";
import type { DbClient } from "../../infrastructure/db/drizzle";
import { listAdminLogs, type AdminLogFilters } from "../../infrastructure/db/admin-log";
import type { OrderStatus } from "../../domain/order/types";

// ---------------------------------------------------------------------------
// ListAdminOrders
// ---------------------------------------------------------------------------

export class ListAdminOrders {
  constructor(private readonly orderRepo: OrderRepository) {}

  async execute(input: { status?: OrderStatus; storeId?: EntityId; limit?: number; offset?: number }) {
    const orders = await this.orderRepo.listAll({
      status: input.status,
      storeId: input.storeId,
      limit: input.limit,
      offset: input.offset,
    });
    return { orders, total: orders.length };
  }
}

// ---------------------------------------------------------------------------
// ListConsentsByUser
// ---------------------------------------------------------------------------

export class ListConsentsByUser {
  constructor(private readonly consentRepo: D1ConsentRepository) {}

  async execute(input: { userId: EntityId; limit?: number; offset?: number }) {
    return this.consentRepo.listByUserId(input.userId, input.limit ?? 50, input.offset ?? 0);
  }
}

// ---------------------------------------------------------------------------
// ListAdminLogs (thin wrapper over the infra helper)
// ---------------------------------------------------------------------------

export class ListAdminLogsUseCase {
  constructor(private readonly db: DbClient) {}

  async execute(input: AdminLogFilters) {
    return listAdminLogs(this.db, input);
  }
}
