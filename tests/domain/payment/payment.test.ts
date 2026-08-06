import { describe, it, expect } from "vitest";
import { Payment } from "../../../src/domain/payment/payment";
import { PaymentStatus } from "../../../src/domain/payment/types";
import { createEntityId } from "../../../src/domain/shared/types";

const orderId = createEntityId();
const storeId = createEntityId();

describe("Payment aggregate", () => {
  it("should create a pending payment", () => {
    const p = Payment.create({
      orderId,
      storeId,
      amount: 85000,
      externalId: "tokko-abc",
      invoiceUrl: "https://checkout.xendit.co/web/abc",
    });

    expect(p.status).toBe(PaymentStatus.Pending);
    expect(p.amount).toBe(85000);
    expect(p.currency).toBe("IDR");
    expect(p.provider).toBe("xendit");
    expect(p.isPaid).toBe(false);
    expect(p.paidAt).toBeNull();
  });

  it("should reject non-positive amounts", () => {
    expect(() =>
      Payment.create({ orderId, storeId, amount: 0, externalId: "x", invoiceUrl: "u" })
    ).toThrow("Amount must be a positive number");
  });

  it("should reject missing external id / invoice url", () => {
    expect(() =>
      Payment.create({ orderId, storeId, amount: 100, externalId: "  ", invoiceUrl: "u" })
    ).toThrow("External id is required");
    expect(() =>
      Payment.create({ orderId, storeId, amount: 100, externalId: "x", invoiceUrl: " " })
    ).toThrow("Invoice url is required");
  });

  it("should mark paid with a timestamp", () => {
    const p = Payment.create({ orderId, storeId, amount: 100, externalId: "x", invoiceUrl: "u" });
    p.markPaid("2026-08-06T10:00:00Z");
    expect(p.status).toBe(PaymentStatus.Paid);
    expect(p.isPaid).toBe(true);
    expect(p.paidAt).toBe("2026-08-06T10:00:00Z");
  });

  it("should mark failed / expired", () => {
    const failed = Payment.create({ orderId, storeId, amount: 100, externalId: "a", invoiceUrl: "u" });
    failed.markFailed();
    expect(failed.status).toBe(PaymentStatus.Failed);

    const expired = Payment.create({ orderId, storeId, amount: 100, externalId: "b", invoiceUrl: "u" });
    expired.markExpired();
    expect(expired.status).toBe(PaymentStatus.Expired);
  });

  it("should reject invalid transitions (paid is terminal)", () => {
    const p = Payment.create({ orderId, storeId, amount: 100, externalId: "x", invoiceUrl: "u" });
    p.markPaid();
    expect(() => p.markExpired()).toThrow("Invalid payment transition");
    expect(() => p.markFailed()).toThrow("Invalid payment transition");
  });

  it("should not transition a failed payment to paid", () => {
    const p = Payment.create({ orderId, storeId, amount: 100, externalId: "x", invoiceUrl: "u" });
    p.markFailed();
    expect(() => p.markPaid()).toThrow("Invalid payment transition");
  });
});
