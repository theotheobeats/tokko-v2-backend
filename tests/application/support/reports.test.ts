import { describe, it, expect, vi } from "vitest";
import { SubmitReport, ReviewReport, ResolveReport, ReportNotFoundError } from "../../../src/application/support/report-use-cases";
import type { ReportRepository } from "../../../src/infrastructure/repos/d1-report-repo";
import { Report } from "../../../src/domain/support/report";
import { ReportResolution } from "../../../src/domain/support/types";
import { createEntityId } from "../../../src/domain/shared/types";

function mockReportRepo(overrides?: Partial<ReportRepository>): ReportRepository {
  return {
    findById: vi.fn().mockResolvedValue(null),
    list: vi.fn().mockResolvedValue({ reports: [], total: 0 }),
    countByStatus: vi.fn().mockResolvedValue({ open: 0, reviewing: 0, resolved: 0, dismissed: 0 }),
    save: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

const storeId = createEntityId();

describe("SubmitReport", () => {
  it("should create and persist a report", async () => {
    const repo = mockReportRepo();
    const result = await new SubmitReport(repo).execute({
      storeId,
      targetType: "store",
      targetId: storeId,
      reason: "fraud",
      details: "barang palsu",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("open");
      expect(result.value.reason).toBe("fraud");
    }
    expect(repo.save).toHaveBeenCalledTimes(1);
  });
});

describe("ReviewReport", () => {
  it("should move an open report to reviewing", async () => {
    const report = Report.create({ storeId, targetType: "store", targetId: storeId, reason: "spam" });
    const repo = mockReportRepo({ findById: vi.fn().mockResolvedValue(report) });

    const result = await new ReviewReport(repo).execute({ reportId: report.id });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.status).toBe("reviewing");
  });

  it("should return not-found", async () => {
    const result = await new ReviewReport(mockReportRepo()).execute({ reportId: createEntityId() });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(ReportNotFoundError);
  });
});

describe("ResolveReport", () => {
  it("should resolve with suspension action", async () => {
    const report = Report.create({ storeId, targetType: "store", targetId: storeId, reason: "fraud" });
    const repo = mockReportRepo({ findById: vi.fn().mockResolvedValue(report) });
    const adminId = createEntityId();

    const result = await new ResolveReport(repo).execute({ reportId: report.id, resolution: ReportResolution.Suspended, adminId });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("resolved");
      expect(result.value.resolution).toBe(ReportResolution.Suspended);
      expect(result.value.resolvedBy).toBe(adminId);
    }
  });

  it("should dismiss", async () => {
    const report = Report.create({ storeId, targetType: "store", targetId: storeId, reason: "other" });
    const repo = mockReportRepo({ findById: vi.fn().mockResolvedValue(report) });

    const result = await new ResolveReport(repo).execute({
      reportId: report.id,
      resolution: ReportResolution.Dismissed,
      adminId: createEntityId(),
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.status).toBe("dismissed");
  });
});
