/**
 * D1 Consent Repository — UU PDP consent audit queries.
 */

import { eq, count, sql } from "drizzle-orm";
import type { EntityId } from "../../domain/shared/types";
import type { DbClient } from "../db/drizzle";
import { consents } from "../db/schema";

export interface ConsentRow {
  id: string;
  userId: string;
  type: string;
  termsVersion: string;
  privacyVersion: string;
  ip: string | null;
  userAgent: string | null;
  createdAt: Date;
}

export class D1ConsentRepository {
  constructor(private readonly db: DbClient) {}

  async listByUserId(userId: EntityId, limit = 50, offset = 0): Promise<{ consents: ConsentRow[]; total: number }> {
    const where = eq(consents.userId, userId as string);

    const totalRow = await this.db
      .select({ count: count() })
      .from(consents)
      .where(where)
      .get();

    const rows = await this.db
      .select()
      .from(consents)
      .where(where)
      .orderBy(sql`${consents.createdAt} DESC`)
      .limit(limit)
      .offset(offset)
      .all();

    return {
      consents: rows.map((r) => ({
        id: r.id,
        userId: r.userId,
        type: r.type,
        termsVersion: r.termsVersion,
        privacyVersion: r.privacyVersion,
        ip: r.ip,
        userAgent: r.userAgent,
        createdAt: r.createdAt,
      })),
      total: totalRow?.count ?? 0,
    };
  }

  async countByUserId(userId: EntityId): Promise<number> {
    const row = await this.db
      .select({ count: count() })
      .from(consents)
      .where(eq(consents.userId, userId as string))
      .get();
    return row?.count ?? 0;
  }
}
