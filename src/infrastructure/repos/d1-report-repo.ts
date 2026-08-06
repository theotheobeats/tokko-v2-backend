/**
 * D1 Report Repository.
 */

import { eq, and, count, sql } from "drizzle-orm";
import type { EntityId } from "../../domain/shared/types";
import { Report } from "../../domain/support/report";
import type {
  ReportStatus,
  ReportReason,
  ReportTargetType,
  ReportResolution,
} from "../../domain/support/types";
import type { DbClient } from "../db/drizzle";
import { reports } from "../db/schema";

export interface ReportListFilters {
  status?: ReportStatus;
  storeId?: EntityId;
  limit?: number;
  offset?: number;
}

export interface ReportRepository {
  findById(id: EntityId): Promise<Report | null>;
  list(filters?: ReportListFilters): Promise<{ reports: Report[]; total: number }>;
  countByStatus(): Promise<Record<string, number>>;
  save(report: Report): Promise<void>;
}

export class D1ReportRepository implements ReportRepository {
  constructor(private readonly db: DbClient) {}

  async findById(id: EntityId): Promise<Report | null> {
    const row = await this.db
      .select()
      .from(reports)
      .where(eq(reports.id, id as string))
      .get();
    return row ? this._toDomain(row) : null;
  }

  async list(filters: ReportListFilters = {}): Promise<{ reports: Report[]; total: number }> {
    const conditions = [];
    if (filters.status) conditions.push(eq(reports.status, filters.status));
    if (filters.storeId) conditions.push(eq(reports.storeId, filters.storeId as string));
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const totalRow = await this.db
      .select({ count: count() })
      .from(reports)
      .where(where)
      .get();

    const rows = await this.db
      .select()
      .from(reports)
      .where(where)
      .orderBy(sql`${reports.createdAt} DESC`)
      .limit(filters.limit ?? 50)
      .offset(filters.offset ?? 0)
      .all();

    return {
      reports: rows.map((r) => this._toDomain(r)),
      total: totalRow?.count ?? 0,
    };
  }

  async countByStatus(): Promise<Record<string, number>> {
    const rows = await this.db
      .select({ status: reports.status, count: count() })
      .from(reports)
      .groupBy(reports.status)
      .all();
    const out: Record<string, number> = { open: 0, reviewing: 0, resolved: 0, dismissed: 0 };
    for (const r of rows) out[r.status] = r.count;
    return out;
  }

  async save(report: Report): Promise<void> {
    const props = report.toJSON();
    const existing = await this.findById(report.id);

    if (existing) {
      await this.db
        .update(reports)
        .set({
          status: props.status,
          resolution: props.resolution,
          resolvedBy: props.resolvedBy ? (props.resolvedBy as string) : null,
          resolvedAt: props.resolvedAt,
        })
        .where(eq(reports.id, props.id as string));
    } else {
      await this.db.insert(reports).values({
        id: props.id as string,
        reporterId: props.reporterId ? (props.reporterId as string) : null,
        storeId: props.storeId as string,
        targetType: props.targetType,
        targetId: props.targetId,
        reason: props.reason,
        details: props.details,
        status: props.status,
      });
    }
  }

  private _toDomain(row: typeof reports.$inferSelect): Report {
    return Report.from({
      id: row.id as EntityId,
      reporterId: row.reporterId ? (row.reporterId as EntityId) : null,
      storeId: row.storeId as EntityId,
      targetType: row.targetType as ReportTargetType,
      targetId: row.targetId,
      reason: row.reason as ReportReason,
      details: row.details,
      status: row.status as ReportStatus,
      resolution: row.resolution as ReportResolution | null,
      resolvedBy: row.resolvedBy ? (row.resolvedBy as EntityId) : null,
      resolvedAt: row.resolvedAt,
      createdAt: row.createdAt,
    });
  }
}
