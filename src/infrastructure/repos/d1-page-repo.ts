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
  save(page: Page): Promise<void>;
  delete(id: EntityId): Promise<void>;
}

export class D1PageRepository implements PageRepository {
  constructor(private readonly db: DbClient) {}

  async findByStoreId(storeId: EntityId): Promise<Page | null> {
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
      .map((r) => ({
        id: r.id as EntityId,
        type: r.type as SectionProps["type"],
        data: JSON.parse(r.data),
        sortOrder: r.sortOrder,
      }));

    return Page.from({
      id: pageRow.id as EntityId,
      storeId: pageRow.storeId as EntityId,
      sections: sectionProps,
    });
  }

  async save(page: Page): Promise<void> {
    const json = page.toJSON();
    const existing = await this.findByStoreId(page.storeId);

    if (existing) {
      // Update page
      await this.db.update(pages)
        .set({ updatedAt: new Date().toISOString() })
        .where(eq(pages.id, page.id as string));

      // Replace sections: delete old, insert new
      await this.db.delete(sections).where(eq(sections.pageId, page.id as string));
    } else {
      await this.db.insert(pages).values({
        id: json.id as string,
        storeId: json.storeId as string,
      });
    }

    // Insert all sections
    if (json.sections.length > 0) {
      await this.db.insert(sections).values(
        json.sections.map((s) => ({
          id: s.id as string,
          pageId: json.id as string,
          type: s.type,
          data: JSON.stringify(s.data),
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
}
