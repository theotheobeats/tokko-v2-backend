/**
 * D1 Page Repository.
 */

import { eq } from "drizzle-orm";
import type { EntityId } from "../../domain/shared/types";
import { Page, type PageProps } from "../../domain/store/page";
import { Section, type SectionProps } from "../../domain/store/section";
import type { DbClient } from "../db/drizzle";
import { pages, sections } from "../db/schema";

export interface PageRepository {
  findByStoreId(storeId: EntityId): Promise<Page | null>;
  findByStoreIdWithTokens(storeId: EntityId): Promise<{ page: Page; designTokens: Record<string, string> | null } | null>;
  save(page: Page, designTokens?: Record<string, string>): Promise<void>;
  delete(id: EntityId): Promise<void>;
  /** Admin: delete the store's page + its sections (store deletion cascade). */
  deleteByStoreId(storeId: EntityId): Promise<void>;
}

export class D1PageRepository implements PageRepository {
  constructor(private readonly db: DbClient) {}

  async findByStoreId(storeId: EntityId): Promise<Page | null> {
    const result = await this.findByStoreIdWithTokens(storeId);
    return result?.page ?? null;
  }

  async findByStoreIdWithTokens(storeId: EntityId): Promise<{ page: Page; designTokens: Record<string, string> | null } | null> {
    const pageRow = await this.db
      .select()
      .from(pages)
      .where(eq(pages.storeId, storeId as string))
      .get();

    if (!pageRow) return null;

    const sectionRows = await this.db
      .select()
      .from(sections)
      .where(eq(sections.pageId, pageRow.id))
      .all();

    const sectionProps: SectionProps[] = sectionRows
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((r) => {
        const data = JSON.parse(r.data);
        return {
          id: r.id as EntityId,
          type: r.type as SectionProps["type"],
          variant: data.variant ?? "default",
          content: data.content ?? {},
          sortOrder: r.sortOrder,
        };
      });

    const page = Page.from({
      id: pageRow.id as EntityId,
      storeId: pageRow.storeId as EntityId,
      sections: sectionProps,
    });

    const designTokens = pageRow.designTokens ? JSON.parse(pageRow.designTokens) : null;

    return { page, designTokens };
  }

  async save(page: Page, designTokens?: Record<string, string>): Promise<void> {
    const json = page.toJSON();
    const existing = await this.findByStoreId(page.storeId);
    const tokensJson = designTokens ? JSON.stringify(designTokens) : undefined;

    if (existing) {
      const updateData: Record<string, unknown> = { updatedAt: new Date().toISOString() };
      if (tokensJson) (updateData as any).designTokens = tokensJson;
      await this.db.update(pages).set(updateData).where(eq(pages.id, page.id as string));
      await this.db.delete(sections).where(eq(sections.pageId, page.id as string));
    } else {
      await this.db.insert(pages).values({
        id: json.id as string,
        storeId: json.storeId as string,
        designTokens: tokensJson ?? null,
      } as any);
    }

    // Insert all sections as structured content { variant, content }
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
    // Delete sections first, then the page
    await this.db.delete(sections).where(eq(sections.pageId, id as string));
    await this.db.delete(pages).where(eq(pages.id, id as string));
  }

  /** Admin: delete the store's page + sections (store deletion cascade). */
  async deleteByStoreId(storeId: EntityId): Promise<void> {
    const pageRow = await this.db
      .select({ id: pages.id })
      .from(pages)
      .where(eq(pages.storeId, storeId as string))
      .get();
    if (pageRow) {
      await this.delete(pageRow.id as EntityId);
    }
  }
}
