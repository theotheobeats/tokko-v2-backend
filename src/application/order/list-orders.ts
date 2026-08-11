/**
 * ListOrders use case.
 */

import type { EntityId } from "../../domain/shared/types";
import type { Result } from "../../domain/shared/types";
import { ok } from "../../domain/shared/types";
import { Order } from "../../domain/order/order";
import type { OrderStatus } from "../../domain/order/types";
import type { OrderRepository } from "../../infrastructure/repos/d1-order-repo";

export interface ListOrdersInput {
  storeId: EntityId;
  status?: OrderStatus;
  limit?: number;
  offset?: number;
  /** Order-history retention window (days) — tier-driven (31/365/1095). */
  retentionDays?: number;
}

export interface ListOrdersOutput {
  orders: ReturnType<Order["toJSON"]>[];
  counts: { all: number; pending: number; contacted: number; completed: number };
}

export class ListOrders {
  constructor(private readonly orderRepo: OrderRepository) {}

  async execute(input: ListOrdersInput): Promise<Result<ListOrdersOutput, never>> {
    // Retention wall (ScaleV mechanic): older orders are hidden, not deleted.
    const since = input.retentionDays
      ? new Date(Date.now() - input.retentionDays * 86_400_000).toISOString()
      : undefined;
    const [orders, counts] = await Promise.all([
      this.orderRepo.findByStoreId(input.storeId, {
        status: input.status,
        since,
        limit: input.limit ?? 50,
        offset: input.offset ?? 0,
      }),
      this.orderRepo.countByStoreId(input.storeId, { since }),
    ]);

    return ok({
      orders: orders.map((o) => o.toJSON()),
      counts,
    });
  }
}
