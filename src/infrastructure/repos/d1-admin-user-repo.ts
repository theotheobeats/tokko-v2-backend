/**
 * D1 Admin User Repository — read-side queries over the better-auth `user`
 * table for the admin panel. Mutations (ban/unban/setRole) go through
 * better-auth's admin API (`auth.api.banUser` etc.) so session state stays
 * consistent — this repo only reads.
 */

import { eq, or, and, like, count, sql } from "drizzle-orm";
import type { EntityId } from "../../domain/shared/types";
import type { DbClient } from "../db/drizzle";
import { user } from "../db/schema";

export interface AdminUserRow {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  role: string;
  banned: boolean;
  banReason: string | null;
  banExpires: Date | null;
  image: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminUserListFilters {
  q?: string; // name / email
  role?: string;
  banned?: boolean;
  limit?: number;
  offset?: number;
}

export class D1AdminUserRepository {
  constructor(private readonly db: DbClient) {}

  async list(filters: AdminUserListFilters = {}): Promise<{ users: AdminUserRow[]; total: number }> {
    const conditions = [];
    if (filters.q?.trim()) {
      const likeQ = `%${filters.q.trim()}%`;
      conditions.push(or(like(user.name, likeQ), like(user.email, likeQ))!);
    }
    if (filters.role) conditions.push(eq(user.role, filters.role));
    if (filters.banned !== undefined) conditions.push(eq(user.banned, filters.banned));
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const totalRow = await this.db
      .select({ count: count() })
      .from(user)
      .where(where)
      .get();

    const rows = await this.db
      .select()
      .from(user)
      .where(where)
      .orderBy(sql`${user.createdAt} DESC`)
      .limit(filters.limit ?? 50)
      .offset(filters.offset ?? 0)
      .all();

    return { users: rows.map((r) => this._toRow(r)), total: totalRow?.count ?? 0 };
  }

  async findById(id: EntityId): Promise<AdminUserRow | null> {
    const row = await this.db
      .select()
      .from(user)
      .where(eq(user.id, id as string))
      .get();
    return row ? this._toRow(row) : null;
  }

  async findByEmail(email: string): Promise<AdminUserRow | null> {
    const row = await this.db
      .select()
      .from(user)
      .where(eq(user.email, email))
      .get();
    return row ? this._toRow(row) : null;
  }

  async counts(): Promise<{ total: number; admins: number; banned: number }> {
    const { count } = await import("drizzle-orm");
    const [totalRow, adminRow, bannedRow] = await Promise.all([
      this.db.select({ count: count() }).from(user).get(),
      this.db.select({ count: count() }).from(user).where(eq(user.role, "admin")).get(),
      this.db.select({ count: count() }).from(user).where(eq(user.banned, true)).get(),
    ]);
    return {
      total: totalRow?.count ?? 0,
      admins: adminRow?.count ?? 0,
      banned: bannedRow?.count ?? 0,
    };
  }

  /** New users registered within the last N days. */
  async since(daysAgo: number): Promise<number> {
    const { count } = await import("drizzle-orm");
    const cutoff = sql`(cast(strftime('%s','now') * 1000 as integer) - ${sql.raw(String(daysAgo * 86400_000))})`;
    const row = await this.db
      .select({ count: count() })
      .from(user)
      .where(sql`${user.createdAt} >= ${cutoff}`)
      .get();
    return row?.count ?? 0;
  }

  private _toRow(row: typeof user.$inferSelect): AdminUserRow {
    return {
      id: row.id,
      name: row.name,
      email: row.email,
      emailVerified: row.emailVerified,
      role: row.role,
      banned: row.banned,
      banReason: row.banReason,
      banExpires: row.banExpires,
      image: row.image,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
