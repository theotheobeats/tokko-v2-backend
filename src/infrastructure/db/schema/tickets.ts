import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { user } from "./users";

/**
 * Support tickets — text-only threads between a store owner and the 7okko
 * support/admin team.
 *
 * `storeId` is optional: a ticket can be about a specific store or general.
 * Messages live in `ticket_messages` (one row per message).
 */
export const tickets = sqliteTable(
  "tickets",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    storeId: text("store_id"),
    ticketCode: text("ticket_code").notNull(),
    subject: text("subject").notNull(),
    category: text("category").notNull().default("general"),
    priority: text("priority").notNull().default("normal"),
    status: text("status").notNull().default("open"),
    createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
    updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
  },
  (t) => [
    index("tickets_user_idx").on(t.userId),
    index("tickets_status_idx").on(t.status),
  ],
);

/** One message in a ticket thread. */
export const ticketMessages = sqliteTable(
  "ticket_messages",
  {
    id: text("id").primaryKey(),
    ticketId: text("ticket_id")
      .notNull()
      .references(() => tickets.id),
    authorId: text("author_id").notNull(),
    /** "user" (ticket owner) or "admin" (support). */
    authorRole: text("author_role").notNull(),
    body: text("body").notNull(),
    createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  },
  (t) => [index("ticket_messages_ticket_idx").on(t.ticketId)],
);
