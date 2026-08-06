/**
 * Support bounded context — domain events.
 */

import type { EntityId } from "../shared/types";
import type { TicketStatus, TicketPriority, TicketCategory } from "./types";
import type { ReportStatus, ReportReason, ReportResolution } from "./types";

export interface TicketCreatedEvent {
  type: "TicketCreated";
  ticketId: EntityId;
  userId: EntityId;
  subject: string;
  category: TicketCategory;
  priority: TicketPriority;
  occurredAt: string;
}

export interface TicketRepliedEvent {
  type: "TicketReplied";
  ticketId: EntityId;
  authorRole: "user" | "admin";
  occurredAt: string;
}

export interface TicketStatusChangedEvent {
  type: "TicketStatusChanged";
  ticketId: EntityId;
  from: TicketStatus;
  to: TicketStatus;
  occurredAt: string;
}

export interface ReportSubmittedEvent {
  type: "ReportSubmitted";
  reportId: EntityId;
  storeId: EntityId;
  reason: ReportReason;
  occurredAt: string;
}

export interface ReportResolvedEvent {
  type: "ReportResolved";
  reportId: EntityId;
  storeId: EntityId;
  resolution: ReportResolution;
  occurredAt: string;
}

export type SupportEvent =
  | TicketCreatedEvent
  | TicketRepliedEvent
  | TicketStatusChangedEvent
  | ReportSubmittedEvent
  | ReportResolvedEvent;

export type { ReportStatus };
