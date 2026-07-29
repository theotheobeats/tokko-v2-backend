/**
 * UpdateOrderStatus use case.
 */

import type { EntityId } from "../../domain/shared/types";
import type { Result } from "../../domain/shared/types";
import { ok, err } from "../../domain/shared/types";
import { Order } from "../../domain/order/order";
import { VALID_TRANSITIONS, type OrderStatus } from "../../domain/order/types";
import type { OrderRepository } from "../../infrastructure/repos/d1-order-repo";

export interface UpdateOrderStatusInput {
  orderId: EntityId;
  status: OrderStatus;
}

export interface UpdateOrderStatusError {
  code: "NOT_FOUND" | "INVALID_STATUS_TRANSITION";
  message: string;
}

export class UpdateOrderStatus {
  constructor(private readonly orderRepo: OrderRepository) {}

  async execute(input: UpdateOrderStatusInput): Promise<Result<ReturnType<Order["toJSON"]>, UpdateOrderStatusError>> {
    const order = await this.orderRepo.findById(input.orderId);
    if (!order) {
      return err({ code: "NOT_FOUND", message: "Pesanan tidak ditemukan." });
    }

    // Validate transition
    const allowed = VALID_TRANSITIONS[order.status];
    if (!allowed.includes(input.status)) {
      return err({
        code: "INVALID_STATUS_TRANSITION",
        message: `Status tidak valid. Hanya bisa: ${allowed.join(", ")}.`,
      });
    }

    // Apply the correct transition
    if (input.status === "contacted") {
      order.markContacted();
    } else if (input.status === "completed") {
      order.markCompleted();
    }

    await this.orderRepo.save(order);
    return ok(order.toJSON());
  }
}
