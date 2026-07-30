/**
 * RegeneratePage use case — AI regenerates all sections of a page.
 */

import type { EntityId } from "../../domain/shared/types";
import type { Result } from "../../domain/shared/types";
import { ok, err } from "../../domain/shared/types";
import { Section, type SectionType } from "../../domain/store/section";
import type { PageRepository } from "../../infrastructure/repos/d1-page-repo";
import { serializePage, type RenderedPage } from "./render-section";

export interface AIGeneratedSections {
  sections: Array<{ type: string; template: string; slots: Record<string, string> }>;
  designTokens?: Record<string, string>;
}

export interface RegeneratePageInput {
  storeId: EntityId;
}

export interface RegeneratePageError {
  code: "PAGE_NOT_FOUND" | "AI_GENERATION_FAILED";
  message: string;
}

export type RegeneratePageOutput = RenderedPage;

export class RegeneratePage {
  constructor(
    private readonly pageRepo: PageRepository,
    private readonly aiGenerate: () => Promise<AIGeneratedSections>,
  ) {}

  async execute(input: RegeneratePageInput): Promise<Result<RegeneratePageOutput, RegeneratePageError>> {
    const page = await this.pageRepo.findByStoreId(input.storeId);
    if (!page) {
      return err({ code: "PAGE_NOT_FOUND", message: "Halaman tidak ditemukan." });
    }

    let aiResult: AIGeneratedSections;
    try {
      aiResult = await this.aiGenerate();
    } catch (error: any) {
      return err({
        code: "AI_GENERATION_FAILED",
        message: error?.message ?? "Gagal membuat ulang halaman.",
      });
    }

    const sections = aiResult.sections.map((s, i) =>
      Section.create({
        type: s.type as SectionType,
        template: s.template,
        slots: s.slots,
        sortOrder: i,
      })
    );

    page.replaceAll(sections);
    await this.pageRepo.save(page, aiResult.designTokens);

    return ok(serializePage(page, aiResult.designTokens ?? null));
  }
}
