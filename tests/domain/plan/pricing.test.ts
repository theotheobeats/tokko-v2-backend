import { describe, it, expect } from "vitest";
import {
  priceFor,
  isValidInvoiceAmount,
  MONTHS_FREE_ANNUAL,
  BETA_MONTHLY,
  PRICE_MONTHLY,
} from "../../../src/domain/plan/pricing";

describe("pricing (beta vs normal)", () => {
  it("keeps the current BETA prices as default (pro 49rb, commerce 99rb)", () => {
    expect(priceFor("pro", "monthly")).toBe(49_000);
    expect(priceFor("commerce", "monthly")).toBe(99_000);
    // explicit beta flag equals the default
    expect(priceFor("pro", "monthly", true)).toBe(49_000);
    expect(priceFor("commerce", "monthly", true)).toBe(99_000);
  });

  it("uses NORMAL prices when out of beta (pro 99rb, commerce 179rb)", () => {
    expect(priceFor("pro", "monthly", false)).toBe(99_000);
    expect(priceFor("commerce", "monthly", false)).toBe(179_000);
  });

  it("always includes 2 months free on annual (annual = 10 × monthly)", () => {
    expect(MONTHS_FREE_ANNUAL).toBe(2);
    // beta
    expect(priceFor("pro", "annual", true)).toBe(490_000); // 49k × 10
    expect(priceFor("commerce", "annual", true)).toBe(990_000); // 99k × 10
    // normal — 2 months free preserved after beta
    expect(priceFor("pro", "annual", false)).toBe(990_000); // 99k × 10
    expect(priceFor("commerce", "annual", false)).toBe(1_790_000); // 179k × 10
  });

  it("exposes the monthly price tables", () => {
    expect(BETA_MONTHLY).toEqual({ pro: 49_000, commerce: 99_000 });
    expect(PRICE_MONTHLY).toEqual({ pro: 99_000, commerce: 179_000 });
  });
});

describe("isValidInvoiceAmount", () => {
  it("accepts both beta and normal prices (grace for pre-flip invoices)", () => {
    expect(isValidInvoiceAmount(49_000, "pro", "monthly")).toBe(true); // beta
    expect(isValidInvoiceAmount(99_000, "pro", "monthly")).toBe(true); // normal
    expect(isValidInvoiceAmount(490_000, "pro", "annual")).toBe(true); // beta
    expect(isValidInvoiceAmount(990_000, "pro", "annual")).toBe(true); // normal
    expect(isValidInvoiceAmount(99_000, "commerce", "monthly")).toBe(true); // beta
    expect(isValidInvoiceAmount(179_000, "commerce", "monthly")).toBe(true); // normal
    expect(isValidInvoiceAmount(1_790_000, "commerce", "annual")).toBe(true); // normal
  });

  it("rejects any other amount (forgery guard)", () => {
    expect(isValidInvoiceAmount(500, "pro", "monthly")).toBe(false);
    expect(isValidInvoiceAmount(50_000, "pro", "monthly")).toBe(false);
    expect(isValidInvoiceAmount(49_000, "commerce", "monthly")).toBe(false);
  });
});
