/**
 * Shared domain primitives.
 */

/** Base type for all entity IDs — UUID v4 as string */
export type EntityId = string & { readonly __brand: "EntityId" };

/** Generate a new unique entity ID */
export function createEntityId(): EntityId {
  return crypto.randomUUID() as EntityId;
}

/** Base result type for domain operations that can fail */
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}
