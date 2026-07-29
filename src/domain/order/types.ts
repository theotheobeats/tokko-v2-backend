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
