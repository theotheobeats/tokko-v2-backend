/**
 * Report aggregate root — a content-moderation report against a store
 * (or one of its products/sections) submitted by any visitor.
 *
 * Lifecycle: open → reviewing → resolved | dismissed.
 * Resolving records the action taken (suspended / warned / dismissed) and
 * the admin who took it, for the audit trail.
 */

import type { EntityId } from "../shared/types";
import { createEntityId } from "../shared/types";
import {
  ReportStatus,
  ReportReason,
  ReportTargetType,
  ReportResolution,
  VALID_REPORT_TRANSITIONS,
  type ReportStatus as ReportStatusType,
  type ReportReason as ReportReasonType,
  type ReportTargetType as ReportTargetTypeType,
  type ReportResolution as ReportResolutionType,
} from "./types";

export interface ReportProps {
  id: EntityId;
  reporterId: EntityId | null; // null for anonymous visitors
  storeId: EntityId;
  targetType: ReportTargetTypeType;
  targetId: string;
  reason: ReportReasonType;
  details: string | null;
  status: ReportStatusType;
  resolution: ReportResolutionType | null;
  resolvedBy: EntityId | null;
  resolvedAt: string | null;
  createdAt: string;
}

export interface NewReportInput {
  reporterId?: EntityId | null;
  storeId: EntityId;
  targetType: ReportTargetTypeType;
  targetId: string;
  reason: ReportReasonType;
  details?: string;
}

export class Report {
  private constructor(private readonly props: ReportProps) {}

  static create(input: NewReportInput): Report {
    return new Report({
      id: createEntityId(),
      reporterId: input.reporterId ?? null,
      storeId: input.storeId,
      targetType: input.targetType,
      targetId: input.targetId.trim(),
      reason: input.reason,
      details: input.details?.trim() || null,
      status: ReportStatus.Open,
      resolution: null,
      resolvedBy: null,
      resolvedAt: null,
      createdAt: new Date().toISOString(),
    });
  }

  static from(props: ReportProps): Report {
    return new Report(props);
  }

  // Getters
  get id() { return this.props.id; }
  get reporterId() { return this.props.reporterId; }
  get storeId() { return this.props.storeId; }
  get targetType() { return this.props.targetType; }
  get targetId() { return this.props.targetId; }
  get reason() { return this.props.reason; }
  get details() { return this.props.details; }
  get status() { return this.props.status; }
  get resolution() { return this.props.resolution; }
  get resolvedBy() { return this.props.resolvedBy; }
  get resolvedAt() { return this.props.resolvedAt; }
  get createdAt() { return this.props.createdAt; }

  /** Move a report into the "reviewing" state. */
  markReviewing(): Report {
    const allowed = VALID_REPORT_TRANSITIONS[this.props.status];
    if (!allowed.includes(ReportStatus.Reviewing)) {
      throw new Error(`Cannot review a ${this.props.status} report`);
    }
    this.props.status = ReportStatus.Reviewing;
    return this;
  }

  /**
   * Resolve a report with the action taken. Terminal state.
   * `suspended` expects the caller to also suspend the target store.
   */
  resolve(resolution: ReportResolutionType, adminId: EntityId): Report {
    const allowed = VALID_REPORT_TRANSITIONS[this.props.status];
    if (!allowed.includes(ReportStatus.Resolved) && !allowed.includes(ReportStatus.Dismissed)) {
      throw new Error(`Cannot resolve a ${this.props.status} report`);
    }
    if (resolution === ReportResolution.Dismissed) {
      this.props.status = ReportStatus.Dismissed;
    } else {
      this.props.status = ReportStatus.Resolved;
    }
    this.props.resolution = resolution;
    this.props.resolvedBy = adminId;
    this.props.resolvedAt = new Date().toISOString();
    return this;
  }

  toJSON(): ReportProps {
    return { ...this.props };
  }
}
