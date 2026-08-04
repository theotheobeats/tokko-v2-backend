/**
 * OrderItem value object.
 */

import type { EntityId, ProductType as ProductTypeT } from "../shared/types";
import { isValidProductType } from "../shared/types";

export interface OrderItemProps {
  productId: EntityId;
  productName: string;
  quantity: number;
  unitPrice: number; // Rupiah
  productType: ProductTypeT; // snapshot of the product kind at order time
}

export class OrderItem {
  private constructor(private readonly props: OrderItemProps) {}

  static create(params: OrderItemProps): OrderItem {
    if (params.quantity < 1) throw new Error("Quantity must be >= 1");
    if (params.unitPrice < 0) throw new Error("Unit price must be >= 0");
    if (!isValidProductType(params.productType)) throw new Error("Invalid product type");

    return new OrderItem({ ...params });
  }

  get productId() { return this.props.productId; }
  get productName() { return this.props.productName; }
  get quantity() { return this.props.quantity; }
  get unitPrice() { return this.props.unitPrice; }
  get productType() { return this.props.productType; }

  /** Total for this line item */
  get subtotal(): number {
    return this.props.quantity * this.props.unitPrice;
  }

  toJSON(): OrderItemProps {
    return { ...this.props };
  }
}
