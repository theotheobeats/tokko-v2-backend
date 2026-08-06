/**
 * Ticket aggregate root — a text-only support thread between a store owner
 * and the 7okko support/admin team.
 */

import type { EntityId } from "../shared/types";
import { createEntityId } from "../shared/types";
import {
  TicketStatus,
  TicketPriority,
  TicketCategory,
  TicketAuthorRole,
  VALID_TICKET_TRANSITIONS,
  type TicketStatus as TicketStatusType,
  type TicketPriority as TicketPriorityType,
  type TicketCategory as TicketCategoryType,
  type TicketAuthorRole as TicketAuthorRoleType,
} from "./types";
import { assertSubject, assertMessageBody, generateTicketCode } from "./rules";

// ---------------------------------------------------------------------------
// TicketMessage (value object)
// ---------------------------------------------------------------------------

export interface TicketMessageProps {
  id: EntityId;
  authorId: EntityId;
  authorRole: TicketAuthorRoleType;
  body: string;
  createdAt: string;
}

export class TicketMessage {
  private constructor(private readonly props: TicketMessageProps) {}

  static create(params: {
    authorId: EntityId;
    authorRole: TicketAuthorRoleType;
    body: string;
  }): TicketMessage {
    return new TicketMessage({
      id: createEntityId(),
      authorId: params.authorId,
      authorRole: params.authorRole,
      body: assertMessageBody(params.body),
      createdAt: new Date().toISOString(),
    });
  }

  static from(props: TicketMessageProps): TicketMessage {
    return new TicketMessage(props);
  }

  get id() { return this.props.id; }
  get authorId() { return this.props.authorId; }
  get authorRole() { return this.props.authorRole; }
  get body() { return this.props.body; }
  get createdAt() { return this.props.createdAt; }

  toJSON(): TicketMessageProps {
    return { ...this.props };
  }
}

// ---------------------------------------------------------------------------
// Ticket (aggregate root)
// ---------------------------------------------------------------------------

export interface TicketProps {
  id: EntityId;
  userId: EntityId;
  storeId: EntityId | null;
  ticketCode: string;
  subject: string;
  category: TicketCategoryType;
  priority: TicketPriorityType;
  status: TicketStatusType;
  messages: TicketMessageProps[];
  createdAt: string;
  updatedAt: string;
}

export interface NewTicketInput {
  userId: EntityId;
  storeId?: EntityId | null;
  subject: string;
  category: TicketCategoryType;
  priority?: TicketPriorityType;
  message: {
    authorId: EntityId;
    authorRole: TicketAuthorRoleType;
    body: string;
  };
}

export class Ticket {
  private constructor(private readonly props: TicketProps) {}

  /** Open a new ticket — subject + first message required. */
  static create(input: NewTicketInput): Ticket {
    const now = new Date().toISOString();
    return new Ticket({
      id: createEntityId(),
      userId: input.userId,
      storeId: input.storeId ?? null,
      ticketCode: generateTicketCode(),
      subject: assertSubject(input.subject),
      category: input.category,
      priority: input.priority ?? TicketPriority.Normal,
      status: TicketStatus.Open,
      messages: [TicketMessage.create(input.message).toJSON()],
      createdAt: now,
      updatedAt: now,
    });
  }

  /** Reconstitute from persistence. */
  static from(props: TicketProps): Ticket {
    return new Ticket({
      ...props,
      storeId: props.storeId ?? null,
      messages: props.messages.map((m) => TicketMessage.from(m).toJSON()),
    });
  }

  // Getters
  get id() { return this.props.id; }
  get userId() { return this.props.userId; }
  get storeId() { return this.props.storeId; }
  get ticketCode() { return this.props.ticketCode; }
  get subject() { return this.props.subject; }
  get category() { return this.props.category; }
  get priority() { return this.props.priority; }
  get status() { return this.props.status; }
  get messages() { return [...this.props.messages]; }
  get createdAt() { return this.props.createdAt; }
  get updatedAt() { return this.props.updatedAt; }

  /** Append a reply. Closed tickets cannot receive replies. */
  addReply(params: { authorId: EntityId; authorRole: TicketAuthorRoleType; body: string }): Ticket {
    if (this.props.status === TicketStatus.Closed) {
      throw new Error("Cannot reply to a closed ticket");
    }
    this.props.messages.push(TicketMessage.create(params).toJSON());
    this.props.updatedAt = new Date().toISOString();
    return this;
  }

  /** Transition to a new status (validated against VALID_TICKET_TRANSITIONS). */
  changeStatus(next: TicketStatusType): Ticket {
    if (next === this.props.status) return this;
    const allowed = VALID_TICKET_TRANSITIONS[this.props.status];
    if (!allowed.includes(next)) {
      throw new Error(`Invalid ticket transition: ${this.props.status} → ${next}`);
    }
    this.props.status = next;
    this.props.updatedAt = new Date().toISOString();
    return this;
  }

  /** Change priority. */
  setPriority(priority: TicketPriorityType): Ticket {
    this.props.priority = priority;
    this.props.updatedAt = new Date().toISOString();
    return this;
  }

  toJSON(): TicketProps {
    return {
      id: this.props.id,
      userId: this.props.userId,
      storeId: this.props.storeId,
      ticketCode: this.props.ticketCode,
      subject: this.props.subject,
      category: this.props.category,
      priority: this.props.priority,
      status: this.props.status,
      messages: this.props.messages.map((m) => ({ ...m })),
      createdAt: this.props.createdAt,
      updatedAt: this.props.updatedAt,
    };
  }
}

// Re-export the role constant for convenience at call sites.
export { TicketAuthorRole };
