/**
 * Store bounded context — domain types and value objects.
 */

export const StoreStatus = {
  Draft: "draft",
  Published: "published",
  Paused: "paused", // trial expired — read-only storefront, orders off
} as const;
export type StoreStatus = (typeof StoreStatus)[keyof typeof StoreStatus];

export const Aesthetic = {
  Minimal: "minimal",
  Warm: "warm",
  Bold: "bold",
} as const;
export type Aesthetic = (typeof Aesthetic)[keyof typeof Aesthetic];

export const BusinessType = {
  Food: "food",
  Fashion: "fashion",
  Gift: "gift",
  Beauty: "beauty",
  Craft: "craft",
  Gadget: "gadget",
  Home: "home",
  Service: "service",
} as const;
export type BusinessType = (typeof BusinessType)[keyof typeof BusinessType];
