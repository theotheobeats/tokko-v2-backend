/**
 * UpdateSection use case.
 */

import type { EntityId } from "../../domain/shared/types";
import type { Result } from "../../domain/shared/types";
import { ok, err } from "../../domain/shared/types";
import type { PageRepository } from "../../infrastructure/repos/d1-page-repo";
import type { SectionProps } from "../../domain/store/section";

export interface UpdateSectionInput {
  storeId: EntityId;
  sectionId: EntityId;
  data: Record<string, unknown>;
}

export interface UpdateSectionError {
  code: "PAGE_NOT_FOUND" | "SECTION_NOT_FOUND";
  message: string;
}

export class UpdateSection {
  constructor(private readonly pageRepo: PageRepository) {}

  async execute(input: UpdateSectionInput): Promise<Result<SectionProps, UpdateSectionError>> {
    const page = await this.pageRepo.findByStoreId(input.storeId);
    if (!page) {
      return err({ code: "PAGE_NOT_FOUND", message: "Halaman tidak ditemukan." });
    }

    const section = page.sections.find((s) => s.id === input.sectionId);
    if (!section) {
      return err({ code: "SECTION_NOT_FOUND", message: "Bagian tidak ditemukan." });
    }

    section.updateData(input.data as any);
    await this.pageRepo.save(page);

    return ok(section.toJSON());
  }
}
