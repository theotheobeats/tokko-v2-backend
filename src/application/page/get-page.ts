/**
 * GetPage use case — returns the requested page (by slug) + the store's
 * page list (for the editor switcher / storefront navbar).
 */

import type { EntityId } from "../../domain/shared/types";
import type { Result } from "../../domain/shared/types";
import { ok } from "../../domain/shared/types";
import { HOME_SLUG } from "../../domain/store/page";
import type { PageRepository, PageMeta } from "../../infrastructure/repos/d1-page-repo";
import { serializePage, type SerializedPage } from "./render-section";

export interface GetPageInput {
  storeId: EntityId;
  slug?: string;
}

export interface GetPageOutput {
  page: SerializedPage | null;
  pages: PageMeta[];
}

export class GetPage {
  constructor(private readonly pageRepo: PageRepository) {}

  async execute(input: GetPageInput): Promise<Result<GetPageOutput, never>> {
    const [page, pages] = await Promise.all([
      this.pageRepo.findByStoreIdAndSlug(input.storeId, input.slug ?? HOME_SLUG),
      this.pageRepo.listByStoreId(input.storeId),
    ]);
    const designTokens = await this.pageRepo.getDesignTokens(input.storeId);

    return ok({
      page: page ? serializePage(page, designTokens) : null,
      pages,
    });
  }
}
