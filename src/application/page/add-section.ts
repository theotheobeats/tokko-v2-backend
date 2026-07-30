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
  serializeSection,
  type RenderedPage,
  type RenderedSection,
} from "./render-section";

export interface AddSectionInput {
  storeId: EntityId;
  type: SectionType;
  template: string;
  slots: Record<string, string>;
  sortOrder?: number;
}

export interface AddSectionError {
  code: "PAGE_NOT_FOUND";
  message: string;
}

export interface AddSectionOutput {
  section: RenderedSection;
  page: RenderedPage;
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
      template: input.template,
      slots: input.slots,
      sortOrder: input.sortOrder ?? page.sections.length,
    });

    page.addSection(section, input.sortOrder);
    await this.pageRepo.save(page);

    return ok({
      section: serializeSection(section.toJSON(), designTokens),
      page: serializePage(page, designTokens),
    });
  }
}
