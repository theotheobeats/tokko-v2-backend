/**
 * Shared domain primitives.
 */

/** Base type for all entity IDs — UUID v4 as string */
export type EntityId = string & { readonly __brand: "EntityId" };

/** Generate a new unique entity ID */
export function createEntityId(): EntityId {
  return crypto.randomUUID() as EntityId;
}

/** Product kind — determines the checkout + fulfillment flow */
export const ProductType = {
  Product: "product",
  Service: "service",
  Booking: "booking",
} as const;
export type ProductType = (typeof ProductType)[keyof typeof ProductType];

/** Check a value is a valid ProductType */
export function isValidProductType(value: unknown): value is ProductType {
  return value === ProductType.Product || value === ProductType.Service || value === ProductType.Booking;
}

/** Base result type for domain operations that can fail */
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}
