/**
 * AddSection use case.
 */

import type { EntityId } from "../../domain/shared/types";
import type { Result } from "../../domain/shared/types";
import { ok, err } from "../../domain/shared/types";
import { Section, type SectionType } from "../../domain/store/section";
import type { PageRepository } from "../../infrastructure/repos/d1-page-repo";
import {
  serializePage,
  type SerializedPage,
  type SerializedSection,
} from "./render-section";

export interface AddSectionInput {
  storeId: EntityId;
  type: SectionType;
  variant: string;
  content: Record<string, unknown>;
  sortOrder?: number;
}

export interface AddSectionError {
  code: "PAGE_NOT_FOUND";
  message: string;
}

export interface AddSectionOutput {
  section: SerializedSection;
  page: SerializedPage;
}

export class AddSection {
  constructor(private readonly pageRepo: PageRepository) {}

  async execute(input: AddSectionInput): Promise<Result<AddSectionOutput, AddSectionError>> {
    const result = await this.pageRepo.findByStoreIdWithTokens(input.storeId);
    if (!result) {
      return err({ code: "PAGE_NOT_FOUND", message: "Halaman tidak ditemukan." });
    }
    const { page, designTokens } = result;

    const section = Section.create({
      type: input.type,
      variant: input.variant,
      content: input.content,
      sortOrder: input.sortOrder ?? page.sections.length,
    });

    page.addSection(section, input.sortOrder);
    await this.pageRepo.save(page);

    return ok({
      section: section.toJSON(),
      page: serializePage(page, designTokens),
    });
  }
}
