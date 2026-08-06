/**
 * D1 Page Repository — multi-page support.
 *
 * The site-wide theme lives on the STORE (stores.design_tokens); this repo
 * exposes getDesignTokens/saveDesignTokens for it so use cases stay clean.
 */

import { eq, and, count, sql } from "drizzle-orm";
import type { EntityId } from "../../domain/shared/types";
import { Page, type PageProps } from "../../domain/store/page";
import { Section, type SectionProps } from "../../domain/store/section";
import type { DbClient } from "../db/drizzle";
import { pages, sections, stores } from "../db/schema";

export interface PageMeta {
  id: EntityId;
  slug: string;
  title: string | null;
}

export interface PageRepository {
  findByStoreIdAndSlug(storeId: EntityId, slug: string): Promise<Page | null>;
  /** Home page (slug "beranda"). */
  findByStoreId(storeId: EntityId): Promise<Page | null>;
  /** Page meta (no sections) — home first, then creation order. */
  listByStoreId(storeId: EntityId): Promise<PageMeta[]>;
  countByStoreId(storeId: EntityId): Promise<number>;
  /** Site-wide theme, read from the store row. */
  getDesignTokens(storeId: EntityId): Promise<Record<string, string> | null>;
  saveDesignTokens(storeId: EntityId, tokens: Record<string, string>): Promise<void>;
  save(page: Page): Promise<void>;
  delete(id: EntityId): Promise<void>;
  /** Delete ALL pages + sections of a store (store deletion cascade). */
  deleteByStoreId(storeId: EntityId): Promise<void>;
}

export class D1PageRepository implements PageRepository {
  constructor(private readonly db: DbClient) {}

  async findByStoreIdAndSlug(storeId: EntityId, slug: string): Promise<Page | null> {
    const pageRow = await this.db
      .select()
      .from(pages)
      .where(and(eq(pages.storeId, storeId as string), eq(pages.slug, slug)))
      .get();

    if (!pageRow) return null;

    const sectionRows = await this.db
      .select()
      .from(sections)
      .where(eq(sections.pageId, pageRow.id))
      .orderBy(sql`${sections.sortOrder} ASC`)
      .all();

    return this._toDomain(pageRow, sectionRows);
  }

  async findByStoreId(storeId: EntityId): Promise<Page | null> {
    return this.findByStoreIdAndSlug(storeId, "beranda");
  }

  async listByStoreId(storeId: EntityId): Promise<PageMeta[]> {
    const rows = await this.db
      .select({ id: pages.id, slug: pages.slug, title: pages.title })
      .from(pages)
      .where(eq(pages.storeId, storeId as string))
      .orderBy(
        sql`CASE WHEN ${pages.slug} = 'beranda' THEN 0 ELSE 1 END`,
        sql`${pages.createdAt} ASC`
      )
      .all();

    return rows.map((r) => ({ id: r.id as EntityId, slug: r.slug, title: r.title }));
  }

  async countByStoreId(storeId: EntityId): Promise<number> {
    const row = await this.db
      .select({ count: count() })
      .from(pages)
      .where(eq(pages.storeId, storeId as string))
      .get();
    return row?.count ?? 0;
  }

  async getDesignTokens(storeId: EntityId): Promise<Record<string, string> | null> {
    const row = await this.db
      .select({ designTokens: stores.designTokens })
      .from(stores)
      .where(eq(stores.id, storeId as string))
      .get();
    if (!row?.designTokens) return null;
    try {
      return JSON.parse(row.designTokens) as Record<string, string>;
    } catch {
      return null;
    }
  }

  async saveDesignTokens(storeId: EntityId, tokens: Record<string, string>): Promise<void> {
    await this.db
      .update(stores)
      .set({ designTokens: JSON.stringify(tokens) })
      .where(eq(stores.id, storeId as string));
  }

  async save(page: Page): Promise<void> {
    const json = page.toJSON();
    const existing = await this.db
      .select({ id: pages.id })
      .from(pages)
      .where(eq(pages.id, json.id as string))
      .get();

    if (existing) {
      await this.db
        .update(pages)
        .set({
          slug: json.slug,
          title: json.title,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(pages.id, json.id as string));
    } else {
      await this.db.insert(pages).values({
        id: json.id as string,
        storeId: json.storeId as string,
        slug: json.slug,
        title: json.title,
      });
    }

    // Replace the section list.
    await this.db.delete(sections).where(eq(sections.pageId, json.id as string));
    if (json.sections.length > 0) {
      await this.db.insert(sections).values(
        json.sections.map((s) => ({
          id: s.id as string,
          pageId: json.id as string,
          type: s.type,
          data: JSON.stringify({ variant: s.variant, content: s.content }),
          sortOrder: s.sortOrder,
        }))
      );
    }
  }

  async delete(id: EntityId): Promise<void> {
    await this.db.delete(sections).where(eq(sections.pageId, id as string));
    await this.db.delete(pages).where(eq(pages.id, id as string));
  }

  async deleteByStoreId(storeId: EntityId): Promise<void> {
    const pageRows = await this.db
      .select({ id: pages.id })
      .from(pages)
      .where(eq(pages.storeId, storeId as string))
      .all();
    const ids = pageRows.map((r) => r.id);
    if (ids.length === 0) return;
    await this.db
      .delete(sections)
      .where(sql`${sections.pageId} IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`);
    await this.db.delete(pages).where(eq(pages.storeId, storeId as string));
  }

  private _toDomain(
    pageRow: typeof pages.$inferSelect,
    sectionRows: (typeof sections.$inferSelect)[]
  ): Page {
    const pageProps: Omit<PageProps, "sections"> & { sections: SectionProps[] } = {
      id: pageRow.id as EntityId,
      storeId: pageRow.storeId as EntityId,
      slug: pageRow.slug,
      title: pageRow.title,
      sections: sectionRows.map((s) => {
        let data: { variant: string; content: Record<string, unknown> } = { variant: "default", content: {} };
        try {
          data = JSON.parse(s.data) as typeof data;
        } catch {
          // legacy/corrupt — fall back to defaults
        }
        return {
          id: s.id as EntityId,
          type: s.type as SectionProps["type"],
          variant: data.variant ?? "default",
          content: data.content ?? {},
          sortOrder: s.sortOrder,
        };
      }),
    };
    return Page.from(pageProps);
  }
}
