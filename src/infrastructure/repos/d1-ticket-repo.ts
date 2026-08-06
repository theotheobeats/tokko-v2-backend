/**
 * D1 Ticket Repository.
 */

import { eq, and, or, like, count, sql } from "drizzle-orm";
import type { EntityId } from "../../domain/shared/types";
import { Ticket, type TicketProps } from "../../domain/support/ticket";
import type { TicketStatus } from "../../domain/support/types";
import type { DbClient } from "../db/drizzle";
import { tickets, ticketMessages } from "../db/schema";

export interface TicketListFilters {
  status?: TicketStatus;
  /** Search ticket code / subject / user email (admin view). */
  q?: string;
  userId?: EntityId;
  limit?: number;
  offset?: number;
}

export interface TicketRepository {
  findById(id: EntityId): Promise<Ticket | null>;
  list(filters?: TicketListFilters): Promise<{ tickets: Ticket[]; total: number }>;
  countByStatus(): Promise<Record<string, number>>;
  save(ticket: Ticket): Promise<void>;
}

export class D1TicketRepository implements TicketRepository {
  constructor(private readonly db: DbClient) {}

  async findById(id: EntityId): Promise<Ticket | null> {
    const row = await this.db
      .select()
      .from(tickets)
      .where(eq(tickets.id, id as string))
      .get();
    if (!row) return null;

    const messages = await this.db
      .select()
      .from(ticketMessages)
      .where(eq(ticketMessages.ticketId, row.id))
      .orderBy(sql`${ticketMessages.createdAt} ASC`)
      .all();

    return this._toDomain(row, messages);
  }

  async list(filters: TicketListFilters = {}): Promise<{ tickets: Ticket[]; total: number }> {
    const conditions = [];
    if (filters.status) conditions.push(eq(tickets.status, filters.status));
    if (filters.userId) conditions.push(eq(tickets.userId, filters.userId as string));
    if (filters.q?.trim()) {
      const likeQ = `%${filters.q.trim()}%`;
      conditions.push(or(like(tickets.ticketCode, likeQ), like(tickets.subject, likeQ))!);
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const totalRow = await this.db
      .select({ count: count() })
      .from(tickets)
      .where(where)
      .get();

    const rows = await this.db
      .select()
      .from(tickets)
      .where(where)
      .orderBy(sql`${tickets.updatedAt} DESC`)
      .limit(filters.limit ?? 50)
      .offset(filters.offset ?? 0)
      .all();

    // Load all messages for the page in one query (IN clause).
    const ids = rows.map((r) => r.id);
    const messageRows = ids.length
      ? await this.db
          .select()
          .from(ticketMessages)
          .where(sql`${ticketMessages.ticketId} IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`)
          .orderBy(sql`${ticketMessages.createdAt} ASC`)
          .all()
      : [];

    const byTicket = new Map<string, typeof messageRows>();
    for (const m of messageRows) {
      const arr = byTicket.get(m.ticketId) ?? [];
      arr.push(m);
      byTicket.set(m.ticketId, arr);
    }

    return {
      tickets: rows.map((r) => this._toDomain(r, byTicket.get(r.id) ?? [])),
      total: totalRow?.count ?? 0,
    };
  }

  async countByStatus(): Promise<Record<string, number>> {
    const rows = await this.db
      .select({ status: tickets.status, count: count() })
      .from(tickets)
      .groupBy(tickets.status)
      .all();
    const out: Record<string, number> = { open: 0, in_progress: 0, resolved: 0, closed: 0 };
    for (const r of rows) out[r.status] = r.count;
    return out;
  }

  async save(ticket: Ticket): Promise<void> {
    const props = ticket.toJSON();
    const existing = await this.findById(ticket.id);

    if (existing) {
      await this.db
        .update(tickets)
        .set({
          subject: props.subject,
          category: props.category,
          priority: props.priority,
          status: props.status,
          updatedAt: props.updatedAt,
        })
        .where(eq(tickets.id, props.id as string));
    } else {
      await this.db.insert(tickets).values({
        id: props.id as string,
        userId: props.userId as string,
        storeId: props.storeId ? (props.storeId as string) : null,
        ticketCode: props.ticketCode,
        subject: props.subject,
        category: props.category,
        priority: props.priority,
        status: props.status,
      });
    }

    // Replace the message thread — threads are small and this keeps
    // insert/update paths identical.
    await this.db.delete(ticketMessages).where(eq(ticketMessages.ticketId, props.id as string));
    if (props.messages.length > 0) {
      await this.db.insert(ticketMessages).values(
        props.messages.map((m) => ({
          id: m.id as string,
          ticketId: props.id as string,
          authorId: m.authorId as string,
          authorRole: m.authorRole,
          body: m.body,
          createdAt: m.createdAt,
        }))
      );
    }
  }

  private _toDomain(
    row: typeof tickets.$inferSelect,
    messageRows: (typeof ticketMessages.$inferSelect)[]
  ): Ticket {
    return Ticket.from({
      id: row.id as EntityId,
      userId: row.userId as EntityId,
      storeId: row.storeId ? (row.storeId as EntityId) : null,
      ticketCode: row.ticketCode,
      subject: row.subject,
      category: row.category as TicketProps["category"],
      priority: row.priority as TicketProps["priority"],
      status: row.status as TicketProps["status"],
      messages: messageRows.map((m) => ({
        id: m.id as EntityId,
        authorId: m.authorId as EntityId,
        authorRole: m.authorRole as TicketProps["messages"][number]["authorRole"],
        body: m.body,
        createdAt: m.createdAt,
      })),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }
}
