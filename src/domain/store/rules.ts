/**
 * Store aggregate — business rules and invariants.
 */

import type { EntityId } from "../shared/types";
import type { Result } from "../shared/types";
import { err, ok } from "../shared/types";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class StoreMustHaveProductsError extends Error {
  constructor() {
    super("Store must have at least one product to publish");
    this.name = "StoreMustHaveProductsError";
  }
}

export class SubdomainAlreadyTakenError extends Error {
  constructor(subdomain: string) {
    super(`Subdomain "${subdomain}" is already taken`);
    this.name = "SubdomainAlreadyTakenError";
  }
}

export class NotStoreOwnerError extends Error {
  constructor() {
    super("Only the store owner can perform this action");
    this.name = "NotStoreOwnerError";
  }
}

// ---------------------------------------------------------------------------
// Domain logic (pure functions)
// ---------------------------------------------------------------------------

/**
 * Generate a URL-safe subdomain from a business name.
 * Matches frontend's `generateSubdomain` in mock-data.ts.
 */
export function generateSubdomain(businessName: string): string {
  return businessName
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .substring(0, 30);
}

/**
 * Validate that a store can be published.
 */
export function canStoreBePublished(productCount: number): boolean {
  return productCount > 0;
}

/**
 * Validate that a product price is valid.
 */
export function isValidPrice(price: number): boolean {
  return price >= 0 && Number.isInteger(price);
}

/**
 * Validate that a product type is one of the supported kinds.
 */
export function isValidProductType(value: unknown): boolean {
  return value === "product" || value === "service" || value === "booking";
}
