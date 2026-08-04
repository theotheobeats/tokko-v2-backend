/**
 * UpdateOrderFulfillment use case — admin attaches fulfillment data:
 *  - product order → nomor resi (trackingNumber) + courier
 *  - service order → payment confirmation (+ note)
 *  - booking order → queue number (nomor antrian)
 */

import type { EntityId } from "../../domain/shared/types";
import type { Result } from "../../domain/shared/types";
import { ok, err } from "../../domain/shared/types";
import { Order } from "../../domain/order/order";
import type { FulfillmentData } from "../../domain/order/types";
import type { OrderRepository } from "../../infrastructure/repos/d1-order-repo";

export interface UpdateOrderFulfillmentInput extends FulfillmentData {
  orderId: EntityId;
}

export interface UpdateOrderFulfillmentError {
  code: "NOT_FOUND" | "VALIDATION";
  message: string;
  field?: string;
}

export class UpdateOrderFulfillment {
  constructor(private readonly orderRepo: OrderRepository) {}

  async execute(input: UpdateOrderFulfillmentInput): Promise<Result<ReturnType<Order["toJSON"]>, UpdateOrderFulfillmentError>> {
    const order = await this.orderRepo.findById(input.orderId);
    if (!order) {
      return err({ code: "NOT_FOUND", message: "Pesanan tidak ditemukan." });
    }

    // Validate provided values (null is allowed — it clears the field)
    if (input.trackingNumber !== undefined && input.trackingNumber !== null && !input.trackingNumber.trim()) {
      return err({ code: "VALIDATION", message: "Nomor resi wajib diisi.", field: "trackingNumber" });
    }
    if (input.courier !== undefined && input.courier !== null && !input.courier.trim()) {
      return err({ code: "VALIDATION", message: "Kurir tidak boleh kosong.", field: "courier" });
    }
    if (input.queueNumber !== undefined && input.queueNumber !== null && !input.queueNumber.trim()) {
      return err({ code: "VALIDATION", message: "Nomor antrian wajib diisi.", field: "queueNumber" });
    }
    if (input.paymentNote !== undefined && input.paymentNote !== null && !input.paymentNote.trim()) {
      return err({ code: "VALIDATION", message: "Catatan pembayaran tidak boleh kosong.", field: "paymentNote" });
    }

    order.updateFulfillment({
      trackingNumber: input.trackingNumber,
      courier: input.courier,
      paymentConfirmed: input.paymentConfirmed,
      paymentNote: input.paymentNote,
      queueNumber: input.queueNumber,
    });

    await this.orderRepo.save(order);
    return ok(order.toJSON());
  }
}
