/**
 * ReorderSections use case.
 */

import type { EntityId } from "../../domain/shared/types";
import type { Result } from "../../domain/shared/types";
import { ok, err } from "../../domain/shared/types";
import type { PageRepository } from "../../infrastructure/repos/d1-page-repo";
import { serializePage, type RenderedPage } from "./render-section";

export interface ReorderSectionsInput {
  storeId: EntityId;
  sectionIds: EntityId[];
}

export interface ReorderSectionsError {
  code: "PAGE_NOT_FOUND";
  message: string;
}

export type ReorderSectionsOutput = RenderedPage;

export class ReorderSections {
  constructor(private readonly pageRepo: PageRepository) {}

  async execute(input: ReorderSectionsInput): Promise<Result<ReorderSectionsOutput, ReorderSectionsError>> {
    const result = await this.pageRepo.findByStoreIdWithTokens(input.storeId);
    if (!result) {
      return err({ code: "PAGE_NOT_FOUND", message: "Halaman tidak ditemukan." });
    }
    const { page, designTokens } = result;

    page.reorder(input.sectionIds);
    await this.pageRepo.save(page);

    return ok(serializePage(page, designTokens));
  }
}
