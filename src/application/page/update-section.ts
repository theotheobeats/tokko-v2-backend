/**
 * UpdateSection use case.
 */

import type { EntityId } from "../../domain/shared/types";
import type { Result } from "../../domain/shared/types";
import { ok, err } from "../../domain/shared/types";
import type { PageRepository } from "../../infrastructure/repos/d1-page-repo";
import {
  serializePage,
  type SerializedPage,
  type SerializedSection,
} from "./render-section";

export interface UpdateSectionInput {
  storeId: EntityId;
  sectionId: EntityId;
  content?: Record<string, unknown>;
  variant?: string;
}

export interface UpdateSectionError {
  code: "PAGE_NOT_FOUND" | "SECTION_NOT_FOUND";
  message: string;
}

export interface UpdateSectionOutput {
  section: SerializedSection;
  page: SerializedPage;
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

    if (input.content) section.updateContent(input.content);
    if (input.variant) section.setVariant(input.variant);
    await this.pageRepo.save(page);

    return ok({
      section: section.toJSON(),
      page: serializePage(page, designTokens),
    });
  }
}
