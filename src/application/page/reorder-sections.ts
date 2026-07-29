/**
 * ReorderSections use case.
 */

import type { EntityId } from "../../domain/shared/types";
import type { Result } from "../../domain/shared/types";
import { ok, err } from "../../domain/shared/types";
import type { SectionProps } from "../../domain/store/section";
import type { PageProps } from "../../domain/store/page";
import type { PageRepository } from "../../infrastructure/repos/d1-page-repo";

export interface ReorderSectionsInput {
  storeId: EntityId;
  sectionIds: EntityId[];
}

export interface ReorderSectionsError {
  code: "PAGE_NOT_FOUND";
  message: string;
}

export type ReorderSectionsOutput = Omit<PageProps, "sections"> & { sections: SectionProps[] };

export class ReorderSections {
  constructor(private readonly pageRepo: PageRepository) {}

  async execute(input: ReorderSectionsInput): Promise<Result<ReorderSectionsOutput, ReorderSectionsError>> {
    const page = await this.pageRepo.findByStoreId(input.storeId);
    if (!page) {
      return err({ code: "PAGE_NOT_FOUND", message: "Halaman tidak ditemukan." });
    }

    page.reorder(input.sectionIds);
    await this.pageRepo.save(page);

    return ok(page.toJSON());
  }
}
