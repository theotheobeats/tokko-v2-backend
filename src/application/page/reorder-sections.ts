/**
 * ReorderSections use case.
 */

import type { EntityId } from "../../domain/shared/types";
import type { Result } from "../../domain/shared/types";
import { ok, err } from "../../domain/shared/types";
import { HOME_SLUG } from "../../domain/store/page";
import type { PageRepository } from "../../infrastructure/repos/d1-page-repo";
import { serializePage, type SerializedPage } from "./render-section";

export interface ReorderSectionsInput {
  storeId: EntityId;
  slug?: string;
  sectionIds: EntityId[];
}

export interface ReorderSectionsError {
  code: "PAGE_NOT_FOUND";
  message: string;
}

export type ReorderSectionsOutput = SerializedPage;

export class ReorderSections {
  constructor(private readonly pageRepo: PageRepository) {}

  async execute(input: ReorderSectionsInput): Promise<Result<ReorderSectionsOutput, ReorderSectionsError>> {
    const page = await this.pageRepo.findByStoreIdAndSlug(input.storeId, input.slug ?? HOME_SLUG);
    if (!page) {
      return err({ code: "PAGE_NOT_FOUND", message: "Halaman tidak ditemukan." });
    }
    const designTokens = await this.pageRepo.getDesignTokens(input.storeId);

    page.reorder(input.sectionIds);
    await this.pageRepo.save(page);

    return ok(serializePage(page, designTokens));
  }
}
