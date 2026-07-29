/**
 * AddSection use case.
 */

import type { EntityId } from "../../domain/shared/types";
import type { Result } from "../../domain/shared/types";
import { ok, err } from "../../domain/shared/types";
import { Section, type SectionType, type SectionData, type SectionProps } from "../../domain/store/section";
import type { PageProps } from "../../domain/store/page";
import type { PageRepository } from "../../infrastructure/repos/d1-page-repo";

export interface AddSectionInput {
  storeId: EntityId;
  type: SectionType;
  data: Record<string, unknown>;
  sortOrder?: number;
}

export interface AddSectionError {
  code: "PAGE_NOT_FOUND";
  message: string;
}

export type AddSectionOutput = Omit<PageProps, "sections"> & { sections: SectionProps[] };

export class AddSection {
  constructor(private readonly pageRepo: PageRepository) {}

  async execute(input: AddSectionInput): Promise<Result<AddSectionOutput, AddSectionError>> {
    const page = await this.pageRepo.findByStoreId(input.storeId);
    if (!page) {
      return err({ code: "PAGE_NOT_FOUND", message: "Halaman tidak ditemukan." });
    }

    const section = Section.create(input.type, input.data as unknown as SectionData, input.sortOrder ?? page.sections.length);
    page.addSection(section, input.sortOrder);
    await this.pageRepo.save(page);

    return ok(page.toJSON());
  }
}
