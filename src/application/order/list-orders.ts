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
}

export interface ListOrdersOutput {
  orders: ReturnType<Order["toJSON"]>[];
  counts: { all: number; pending: number; contacted: number; completed: number };
}

export class ListOrders {
  constructor(private readonly orderRepo: OrderRepository) {}

  async execute(input: ListOrdersInput): Promise<Result<ListOrdersOutput, never>> {
    const [orders, counts] = await Promise.all([
      this.orderRepo.findByStoreId(input.storeId, {
        status: input.status,
        limit: input.limit ?? 50,
        offset: input.offset ?? 0,
      }),
      this.orderRepo.countByStoreId(input.storeId),
    ]);

    return ok({
      orders: orders.map((o) => o.toJSON()),
      counts,
    });
  }
}
