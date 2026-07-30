/**
 * UpdateSection use case.
 */

import type { EntityId } from "../../domain/shared/types";
import type { Result } from "../../domain/shared/types";
import { ok, err } from "../../domain/shared/types";
import type { PageRepository } from "../../infrastructure/repos/d1-page-repo";
import {
  serializePage,
  serializeSection,
  type RenderedPage,
  type RenderedSection,
} from "./render-section";

export interface UpdateSectionInput {
  storeId: EntityId;
  sectionId: EntityId;
  slots?: Record<string, string>;
}

export interface UpdateSectionError {
  code: "PAGE_NOT_FOUND" | "SECTION_NOT_FOUND";
  message: string;
}

export interface UpdateSectionOutput {
  section: RenderedSection;
  page: RenderedPage;
}

export class UpdateSection {
  constructor(private readonly pageRepo: PageRepository) {}

  async execute(
    input: UpdateSectionInput
  ): Promise<Result<UpdateSectionOutput, UpdateSectionError>> {
    const result = await this.pageRepo.findByStoreIdWithTokens(input.storeId);
    if (!result) {
      return err({ code: "PAGE_NOT_FOUND", message: "Halaman tidak ditemukan." });
    }
    const { page, designTokens } = result;

    const section = page.sections.find((s) => s.id === input.sectionId);
    if (!section) {
      return err({ code: "SECTION_NOT_FOUND", message: "Bagian tidak ditemukan." });
    }

    section.updateSlots(input.slots ?? {});
    await this.pageRepo.save(page);

    return ok({
      section: serializeSection(section.toJSON(), designTokens),
      page: serializePage(page, designTokens),
    });
  }
}
