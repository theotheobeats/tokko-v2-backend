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

/** Validate a stock count (null = unlimited; must be a non-negative integer). */
export function isValidStock(stock: number): boolean {
  return Number.isInteger(stock) && stock >= 0;
}

/**
 * Validate that a product type is one of the supported kinds.
 */
export function isValidProductType(value: unknown): boolean {
  return value === "product" || value === "service" || value === "booking";
}

/**
 * Generate a URL-safe slug from a product name (mirrors the frontend
 * slugify so dashboard and storefront agree).
 */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .substring(0, 80);
}

/** Validate a slug is URL-safe (lowercase letters, digits, hyphens). */
export function isValidSlug(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}
