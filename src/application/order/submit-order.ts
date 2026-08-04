/**
 * SubmitOrder use case.
 */

import type { EntityId } from "../../domain/shared/types";
import type { Result } from "../../domain/shared/types";
import { ok, err } from "../../domain/shared/types";
import { Order } from "../../domain/order/order";
import type { Product } from "../../domain/store/product";
import type { OrderRepository } from "../../infrastructure/repos/d1-order-repo";
import type { ProductRepository } from "../../infrastructure/repos/d1-product-repo";

export interface SubmitOrderInput {
  storeId: EntityId;
  customerName: string;
  customerPhone: string;
  items: { productId: EntityId; quantity: number }[];
  notes?: string;
  shippingAddress?: string;
}

export interface SubmitOrderError {
  code: "VALIDATION" | "PRODUCT_UNAVAILABLE";
  message: string;
  field?: string;
}

export class SubmitOrder {
  constructor(
    private readonly orderRepo: OrderRepository,
    private readonly productRepo: ProductRepository,
  ) {}

  async execute(input: SubmitOrderInput): Promise<Result<ReturnType<Order["toJSON"]>, SubmitOrderError>> {
    // Validate
    if (!input.customerName.trim()) {
      return err({ code: "VALIDATION", message: "Nama wajib diisi.", field: "customerName" });
    }
    if (!input.customerPhone.trim()) {
      return err({ code: "VALIDATION", message: "Nomor HP wajib diisi.", field: "customerPhone" });
    }
    if (input.items.length === 0) {
      return err({ code: "VALIDATION", message: "Pesanan harus memiliki minimal 1 produk.", field: "items" });
    }

    // Fetch products from DB (never trust client prices)
    const orderItems: { productId: EntityId; productName: string; quantity: number; unitPrice: number; productType: Product["type"] }[] = [];

    for (const item of input.items) {
      const product = await this.productRepo.findById(item.productId);
      if (!product || !product.isAvailable) {
        return err({ code: "PRODUCT_UNAVAILABLE", message: `Produk tidak tersedia.`, field: "items" });
      }
      if (item.quantity < 1) {
        return err({ code: "VALIDATION", message: "Jumlah minimal 1.", field: "items" });
      }

      orderItems.push({
        productId: product.id,
        productName: product.name,
        quantity: item.quantity,
        unitPrice: product.price, // Price from DB — never trust client
        productType: product.type,
      });
    }

    // Physical products must always carry a shipping address
    const hasPhysicalItem = orderItems.some((i) => i.productType === "product");
    if (hasPhysicalItem && !input.shippingAddress?.trim()) {
      return err({ code: "VALIDATION", message: "Alamat pengiriman wajib diisi.", field: "shippingAddress" });
    }

    // Create order
    const order = Order.create({
      storeId: input.storeId,
      customerName: input.customerName,
      customerPhone: input.customerPhone,
      items: orderItems,
      notes: input.notes,
      shippingAddress: input.shippingAddress,
    });

    await this.orderRepo.save(order);
    return ok(order.toJSON());
  }
}
