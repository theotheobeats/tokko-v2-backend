/**
 * RemoveSection use case.
 */

import type { EntityId } from "../../domain/shared/types";
import type { Result } from "../../domain/shared/types";
import { ok, err } from "../../domain/shared/types";
import type { SectionProps } from "../../domain/store/section";
import type { PageProps } from "../../domain/store/page";
import type { PageRepository } from "../../infrastructure/repos/d1-page-repo";

export interface RemoveSectionInput {
  storeId: EntityId;
  sectionId: EntityId;
}

export interface RemoveSectionError {
  code: "PAGE_NOT_FOUND";
  message: string;
}

export type RemoveSectionOutput = Omit<PageProps, "sections"> & { sections: SectionProps[] };

export class RemoveSection {
  constructor(private readonly pageRepo: PageRepository) {}

  async execute(input: RemoveSectionInput): Promise<Result<RemoveSectionOutput, RemoveSectionError>> {
    const page = await this.pageRepo.findByStoreId(input.storeId);
    if (!page) {
      return err({ code: "PAGE_NOT_FOUND", message: "Halaman tidak ditemukan." });
    }

    page.removeSection(input.sectionId);
    await this.pageRepo.save(page);

    return ok(page.toJSON());
  }
}
