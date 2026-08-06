/**
 * Support bounded context — domain types and value objects.
 *
 * Two aggregates live here:
 *   - Ticket  — store-owner support conversations (text-only threads)
 *   - Report  — user-generated content moderation reports against a store
 */

// ---------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------

export const TicketStatus = {
  Open: "open",
  InProgress: "in_progress",
  Resolved: "resolved",
  Closed: "closed",
} as const;
export type TicketStatus = (typeof TicketStatus)[keyof typeof TicketStatus];

export const TicketPriority = {
  Low: "low",
  Normal: "normal",
  High: "high",
  Urgent: "urgent",
} as const;
export type TicketPriority = (typeof TicketPriority)[keyof typeof TicketPriority];

export const TicketCategory = {
  General: "general",
  Technical: "technical",
  Billing: "billing",
  Abuse: "abuse",
  Feature: "feature",
} as const;
export type TicketCategory = (typeof TicketCategory)[keyof typeof TicketCategory];

/** Who wrote a ticket message — user or admin. */
export const TicketAuthorRole = {
  User: "user",
  Admin: "admin",
} as const;
export type TicketAuthorRole = (typeof TicketAuthorRole)[keyof typeof TicketAuthorRole];

/** Valid ticket status transitions (closed is terminal unless reopened). */
export const VALID_TICKET_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  open: ["in_progress", "closed"],
  in_progress: ["resolved", "closed"],
  resolved: ["closed", "open"], // reopen
  closed: ["open"], // reopen
};

// ---------------------------------------------------------------------------
// Reports (content moderation)
// ---------------------------------------------------------------------------

export const ReportStatus = {
  Open: "open",
  Reviewing: "reviewing",
  Resolved: "resolved",
  Dismissed: "dismissed",
} as const;
export type ReportStatus = (typeof ReportStatus)[keyof typeof ReportStatus];

export const ReportReason = {
  Spam: "spam",
  Inappropriate: "inappropriate",
  Fraud: "fraud",
  Copyright: "copyright",
  Other: "other",
} as const;
export type ReportReason = (typeof ReportReason)[keyof typeof ReportReason];

export const ReportTargetType = {
  Store: "store",
  Product: "product",
  Section: "section",
  User: "user",
} as const;
export type ReportTargetType = (typeof ReportTargetType)[keyof typeof ReportTargetType];

/** The action an admin took after reviewing a report. */
export const ReportResolution = {
  Suspended: "suspended",
  Warned: "warned",
  Dismissed: "dismissed",
} as const;
export type ReportResolution = (typeof ReportResolution)[keyof typeof ReportResolution];

/** Valid report status transitions. */
export const VALID_REPORT_TRANSITIONS: Record<ReportStatus, ReportStatus[]> = {
  open: ["reviewing", "resolved", "dismissed"],
  reviewing: ["resolved", "dismissed"],
  resolved: [],
  dismissed: [],
};
