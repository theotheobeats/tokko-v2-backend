/**
 * GetPage use case.
 */

import type { EntityId } from "../../domain/shared/types";
import type { Result } from "../../domain/shared/types";
import { ok } from "../../domain/shared/types";
import type { PageRepository } from "../../infrastructure/repos/d1-page-repo";
import { serializePage, type RenderedPage } from "./render-section";

export interface GetPageInput {
  storeId: EntityId;
}

export type GetPageOutput = RenderedPage | null;

export class GetPage {
  constructor(private readonly pageRepo: PageRepository) {}

  async execute(input: GetPageInput): Promise<Result<GetPageOutput, never>> {
    const result = await this.pageRepo.findByStoreIdWithTokens(input.storeId);
    if (!result) return ok(null);
    return ok(serializePage(result.page, result.designTokens));
  }
}
