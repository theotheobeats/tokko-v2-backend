/**
 * Order aggregate root.
 */

import type { EntityId } from "../shared/types";
import { createEntityId } from "../shared/types";
import { OrderStatus, VALID_TRANSITIONS, type OrderStatus as OrderStatusType } from "./types";
import { OrderItem, type OrderItemProps } from "./order-item";

export interface OrderProps {
  id: EntityId;
  storeId: EntityId;
  customerName: string;
  customerPhone: string;
  items: OrderItem[];
  totalAmount: number;
  status: OrderStatusType;
  notes: string | null;
  createdAt?: string;
}

export class Order {
  private constructor(private readonly props: OrderProps) {}

  static create(params: {
    storeId: EntityId;
    customerName: string;
    customerPhone: string;
    items: { productId: EntityId; productName: string; quantity: number; unitPrice: number }[];
    notes?: string;
  }): Order {
    if (!params.customerName.trim()) throw new Error("Customer name is required");
    if (!params.customerPhone.trim()) throw new Error("Customer phone is required");
    if (params.items.length === 0) throw new Error("Order must have at least 1 item");

    const orderItems = params.items.map((i) => OrderItem.create(i));
    const totalAmount = orderItems.reduce((sum, item) => sum + item.subtotal, 0);

    return new Order({
      id: createEntityId(),
      storeId: params.storeId,
      customerName: params.customerName.trim(),
      customerPhone: params.customerPhone.trim(),
      items: orderItems,
      totalAmount,
      status: OrderStatus.Pending,
      notes: params.notes ?? null,
      createdAt: new Date().toISOString(),
    });
  }

  static from(props: Omit<OrderProps, 'items'> & { items: OrderItemProps[] }): Order {
    return new Order({
      ...props,
      items: props.items.map((i) => OrderItem.create(i)),
    });
  }

  get id() { return this.props.id; }
  get storeId() { return this.props.storeId; }
  get customerName() { return this.props.customerName; }
  get customerPhone() { return this.props.customerPhone; }
  get items() { return [...this.props.items]; }
  get totalAmount() { return this.props.totalAmount; }
  get status() { return this.props.status; }
  get notes() { return this.props.notes; }

  /** Transition to a new status */
  advanceStatus(): Order {
    const allowed = VALID_TRANSITIONS[this.props.status];
    if (allowed.length === 0) {
      throw new Error(`Order already in final status: ${this.props.status}`);
    }
    this.props.status = allowed[0]; // pending→contacted, contacted→completed
    return this;
  }

  /** Mark as contacted */
  markContacted(): Order {
    if (this.props.status !== OrderStatus.Pending) {
      throw new Error("Only pending orders can be marked as contacted");
    }
    this.props.status = OrderStatus.Contacted;
    return this;
  }

  /** Mark as completed */
  markCompleted(): Order {
    if (this.props.status !== OrderStatus.Contacted) {
      throw new Error("Only contacted orders can be marked as completed");
    }
    this.props.status = OrderStatus.Completed;
    return this;
  }

  toJSON(): Omit<OrderProps, 'items'> & { items: OrderItemProps[] } {
    return {
      id: this.props.id,
      storeId: this.props.storeId,
      customerName: this.props.customerName,
      customerPhone: this.props.customerPhone,
      items: this.props.items.map((i) => i.toJSON()),
      totalAmount: this.props.totalAmount,
      status: this.props.status,
      notes: this.props.notes,
      createdAt: this.props.createdAt,
    };
  }
}
