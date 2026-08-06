import { describe, it, expect } from "vitest";
import { Report } from "../../../src/domain/support/report";
import { ReportStatus, ReportResolution } from "../../../src/domain/support/types";
import { createEntityId } from "../../../src/domain/shared/types";

const reporterId = createEntityId();
const storeId = createEntityId();

describe("Report aggregate", () => {
  it("should open a report", () => {
    const r = Report.create({
      reporterId,
      storeId,
      targetType: "store",
      targetId: storeId,
      reason: "fraud",
      details: "Toko menjual barang palsu",
    });

    expect(r.status).toBe(ReportStatus.Open);
    expect(r.reason).toBe("fraud");
    expect(r.resolution).toBeNull();
    expect(r.resolvedBy).toBeNull();
  });

  it("should allow anonymous reports", () => {
    const r = Report.create({ storeId, targetType: "store", targetId: storeId, reason: "spam" });
    expect(r.reporterId).toBeNull();
  });

  it("should move to reviewing then resolve with an action", () => {
    const r = Report.create({ storeId, targetType: "store", targetId: storeId, reason: "inappropriate" });
    r.markReviewing();
    expect(r.status).toBe(ReportStatus.Reviewing);

    const adminId = createEntityId();
    r.resolve(ReportResolution.Suspended, adminId);
    expect(r.status).toBe(ReportStatus.Resolved);
    expect(r.resolution).toBe(ReportResolution.Suspended);
    expect(r.resolvedBy).toBe(adminId);
    expect(r.resolvedAt).not.toBeNull();
  });

  it("should dismiss instead of resolve for dismissed actions", () => {
    const r = Report.create({ storeId, targetType: "store", targetId: storeId, reason: "other" });
    const adminId = createEntityId();
    r.resolve(ReportResolution.Dismissed, adminId);
    expect(r.status).toBe(ReportStatus.Dismissed);
  });

  it("should reject resolution of an already-resolved report", () => {
    const r = Report.create({ storeId, targetType: "store", targetId: storeId, reason: "fraud" });
    const adminId = createEntityId();
    r.resolve(ReportResolution.Warned, adminId);
    expect(() => r.resolve(ReportResolution.Suspended, adminId)).toThrow("Cannot resolve a resolved report");
  });

  it("should reject reviewing a resolved report", () => {
    const r = Report.create({ storeId, targetType: "store", targetId: storeId, reason: "fraud" });
    r.resolve(ReportResolution.Dismissed, createEntityId());
    expect(() => r.markReviewing()).toThrow("Cannot review a dismissed report");
  });
});
