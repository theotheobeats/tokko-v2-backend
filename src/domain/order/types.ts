/**
 * Order bounded context — domain types and value objects.
 */

export const OrderStatus = {
  Pending: "pending",
  Contacted: "contacted",
  Completed: "completed",
} as const;
export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];

/** Valid status transitions */
export const VALID_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ["contacted"],
  contacted: ["completed"],
  completed: [],
};

/** Fulfillment fields the admin can attach per order type */
export type FulfillmentField = "trackingNumber" | "paymentConfirmed" | "queueNumber";

/** Fulfillment data attached by the store owner (admin) */
export interface FulfillmentData {
  trackingNumber?: string | null;
  courier?: string | null;
  paymentConfirmed?: boolean;
  paymentNote?: string | null;
  queueNumber?: string | null;
}

/** How the order gets to the customer (shipping). */
export type ShippingOption = "courier" | "pickup" | "manual";
export const SHIPPING_OPTIONS: ShippingOption[] = ["courier", "pickup", "manual"];

export function isShippingOption(value: unknown): value is ShippingOption {
  return typeof value === "string" && (SHIPPING_OPTIONS as string[]).includes(value);
}
