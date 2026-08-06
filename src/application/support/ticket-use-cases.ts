/**
 * Support bounded context — ticket use cases.
 */

import type { EntityId } from "../../domain/shared/types";
import type { Result } from "../../domain/shared/types";
import { ok, err } from "../../domain/shared/types";
import { Ticket } from "../../domain/support/ticket";
import type {
  TicketStatus,
  TicketPriority,
  TicketCategory,
  TicketAuthorRole,
} from "../../domain/support/types";
import type { TicketRepository } from "../../infrastructure/repos/d1-ticket-repo";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class TicketNotFoundError extends Error {
  code = "TICKET_NOT_FOUND";
  constructor() {
    super("Ticket tidak ditemukan");
  }
}

export class TicketForbiddenError extends Error {
  code = "TICKET_FORBIDDEN";
  constructor() {
    super("Bukan pemilik tiket ini");
  }
}

export class TicketMutationError extends Error {
  code = "TICKET_INVALID";
  constructor(message: string) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// SubmitTicket
// ---------------------------------------------------------------------------

export interface SubmitTicketInput {
  userId: EntityId;
  storeId?: EntityId | null;
  subject: string;
  category: TicketCategory;
  priority?: TicketPriority;
  messageBody: string;
}

export class SubmitTicket {
  constructor(private readonly ticketRepo: TicketRepository) {}

  async execute(input: SubmitTicketInput): Promise<Result<Ticket, Error>> {
    try {
      const ticket = Ticket.create({
        userId: input.userId,
        storeId: input.storeId,
        subject: input.subject,
        category: input.category,
        priority: input.priority,
        message: {
          authorId: input.userId,
          authorRole: "user",
          body: input.messageBody,
        },
      });
      await this.ticketRepo.save(ticket);
      return ok(ticket);
    } catch (e) {
      return err(e instanceof Error ? e : new Error("Failed to create ticket"));
    }
  }
}

// ---------------------------------------------------------------------------
// ListMyTickets
// ---------------------------------------------------------------------------

export class ListMyTickets {
  constructor(private readonly ticketRepo: TicketRepository) {}

  async execute(input: { userId: EntityId; status?: TicketStatus; limit?: number; offset?: number }): Promise<Result<{ tickets: Ticket[]; total: number }, Error>> {
    const res = await this.ticketRepo.list({
      userId: input.userId,
      status: input.status,
      limit: input.limit,
      offset: input.offset,
    });
    return ok(res);
  }
}

// ---------------------------------------------------------------------------
// GetTicket — owner or admin
// ---------------------------------------------------------------------------

export class GetTicket {
  constructor(private readonly ticketRepo: TicketRepository) {}

  async execute(input: { ticketId: EntityId; viewerId: EntityId; isAdmin?: boolean }): Promise<Result<Ticket, TicketNotFoundError | TicketForbiddenError>> {
    const ticket = await this.ticketRepo.findById(input.ticketId);
    if (!ticket) return err(new TicketNotFoundError());
    if (!input.isAdmin && ticket.userId !== input.viewerId) {
      return err(new TicketForbiddenError());
    }
    return ok(ticket);
  }
}

// ---------------------------------------------------------------------------
// ReplyTicket
// ---------------------------------------------------------------------------

export class ReplyTicket {
  constructor(private readonly ticketRepo: TicketRepository) {}

  async execute(input: {
    ticketId: EntityId;
    authorId: EntityId;
    authorRole: TicketAuthorRole;
    body: string;
    isAdmin?: boolean;
  }): Promise<Result<Ticket, TicketNotFoundError | TicketForbiddenError | TicketMutationError>> {
    const ticket = await this.ticketRepo.findById(input.ticketId);
    if (!ticket) return err(new TicketNotFoundError());
    if (!input.isAdmin && ticket.userId !== input.authorId) {
      return err(new TicketForbiddenError());
    }
    try {
      ticket.addReply({ authorId: input.authorId, authorRole: input.authorRole, body: input.body });
      await this.ticketRepo.save(ticket);
      return ok(ticket);
    } catch (e) {
      return err(new TicketMutationError(e instanceof Error ? e.message : "Failed to reply"));
    }
  }
}

// ---------------------------------------------------------------------------
// UpdateTicketStatus
// ---------------------------------------------------------------------------

export class UpdateTicketStatus {
  constructor(private readonly ticketRepo: TicketRepository) {}

  async execute(input: { ticketId: EntityId; status: TicketStatus }): Promise<Result<Ticket, TicketNotFoundError | TicketMutationError>> {
    const ticket = await this.ticketRepo.findById(input.ticketId);
    if (!ticket) return err(new TicketNotFoundError());
    try {
      ticket.changeStatus(input.status);
      await this.ticketRepo.save(ticket);
      return ok(ticket);
    } catch (e) {
      return err(new TicketMutationError(e instanceof Error ? e.message : "Failed to update status"));
    }
  }
}

// ---------------------------------------------------------------------------
// AdminListTickets
// ---------------------------------------------------------------------------

export class AdminListTickets {
  constructor(private readonly ticketRepo: TicketRepository) {}

  async execute(input: { status?: TicketStatus; q?: string; limit?: number; offset?: number }) {
    return this.ticketRepo.list({
      status: input.status,
      q: input.q,
      limit: input.limit,
      offset: input.offset,
    });
  }
}
