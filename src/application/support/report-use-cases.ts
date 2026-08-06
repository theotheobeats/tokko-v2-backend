/**
 * Support bounded context — report (content moderation) use cases.
 */

import type { EntityId } from "../../domain/shared/types";
import type { Result } from "../../domain/shared/types";
import { ok, err } from "../../domain/shared/types";
import { Report } from "../../domain/support/report";
import type {
  ReportStatus,
  ReportReason,
  ReportTargetType,
  ReportResolution,
} from "../../domain/support/types";
import type { ReportRepository } from "../../infrastructure/repos/d1-report-repo";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class ReportNotFoundError extends Error {
  code = "REPORT_NOT_FOUND";
  constructor() {
    super("Laporan tidak ditemukan");
  }
}

export class SelfReportError extends Error {
  code = "SELF_REPORT";
  constructor() {
    super("Tidak bisa melaporkan toko sendiri");
  }
}

export class ReportMutationError extends Error {
  code = "REPORT_INVALID";
  constructor(message: string) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// SubmitReport (public / logged-in)
// ---------------------------------------------------------------------------

export interface SubmitReportInput {
  reporterId?: EntityId | null;
  storeId: EntityId;
  targetType: ReportTargetType;
  targetId: string;
  reason: ReportReason;
  details?: string;
}

export class SubmitReport {
  constructor(private readonly reportRepo: ReportRepository) {}

  async execute(input: SubmitReportInput): Promise<Result<Report, Error>> {
    try {
      const report = Report.create(input);
      await this.reportRepo.save(report);
      return ok(report);
    } catch (e) {
      return err(e instanceof Error ? e : new Error("Failed to submit report"));
    }
  }
}

// ---------------------------------------------------------------------------
// AdminListReports
// ---------------------------------------------------------------------------

export class AdminListReports {
  constructor(private readonly reportRepo: ReportRepository) {}

  async execute(input: { status?: ReportStatus; storeId?: EntityId; limit?: number; offset?: number }) {
    return this.reportRepo.list({
      status: input.status,
      storeId: input.storeId,
      limit: input.limit,
      offset: input.offset,
    });
  }
}

// ---------------------------------------------------------------------------
// GetReport (admin)
// ---------------------------------------------------------------------------

export class GetReport {
  constructor(private readonly reportRepo: ReportRepository) {}

  async execute(input: { reportId: EntityId }): Promise<Result<Report, ReportNotFoundError>> {
    const report = await this.reportRepo.findById(input.reportId);
    if (!report) return err(new ReportNotFoundError());
    return ok(report);
  }
}

// ---------------------------------------------------------------------------
// ReviewReport — move open → reviewing
// ---------------------------------------------------------------------------

export class ReviewReport {
  constructor(private readonly reportRepo: ReportRepository) {}

  async execute(input: { reportId: EntityId }): Promise<Result<Report, ReportNotFoundError | ReportMutationError>> {
    const report = await this.reportRepo.findById(input.reportId);
    if (!report) return err(new ReportNotFoundError());
    try {
      report.markReviewing();
      await this.reportRepo.save(report);
      return ok(report);
    } catch (e) {
      return err(new ReportMutationError(e instanceof Error ? e.message : "Failed to update report"));
    }
  }
}

// ---------------------------------------------------------------------------
// ResolveReport — resolve/dismiss with the action taken
// ---------------------------------------------------------------------------

export class ResolveReport {
  constructor(private readonly reportRepo: ReportRepository) {}

  async execute(input: { reportId: EntityId; resolution: ReportResolution; adminId: EntityId }): Promise<Result<Report, ReportNotFoundError | ReportMutationError>> {
    const report = await this.reportRepo.findById(input.reportId);
    if (!report) return err(new ReportNotFoundError());
    try {
      report.resolve(input.resolution, input.adminId);
      await this.reportRepo.save(report);
      return ok(report);
    } catch (e) {
      return err(new ReportMutationError(e instanceof Error ? e.message : "Failed to resolve report"));
    }
  }
}
