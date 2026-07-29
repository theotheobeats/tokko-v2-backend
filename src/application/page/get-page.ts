/**
 * GetPage use case.
 */

import type { EntityId } from "../../domain/shared/types";
import type { Result } from "../../domain/shared/types";
import { ok } from "../../domain/shared/types";
import type { PageRepository } from "../../infrastructure/repos/d1-page-repo";
import type { PageProps } from "../../domain/store/page";
import type { SectionProps } from "../../domain/store/section";

export interface GetPageInput {
  storeId: EntityId;
}

export type GetPageOutput = (Omit<PageProps, "sections"> & { sections: SectionProps[] }) | null;

export class GetPage {
  constructor(private readonly pageRepo: PageRepository) {}

  async execute(input: GetPageInput): Promise<Result<GetPageOutput, never>> {
    const page = await this.pageRepo.findByStoreId(input.storeId);
    if (!page) return ok(null);
    return ok(page.toJSON());
  }
}
