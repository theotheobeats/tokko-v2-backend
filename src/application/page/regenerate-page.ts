/**
 * RegeneratePage use case — AI regenerates all sections of a page.
 */

import type { EntityId } from "../../domain/shared/types";
import type { Result } from "../../domain/shared/types";
import { ok, err } from "../../domain/shared/types";
import { Section, type SectionType } from "../../domain/store/section";
import type { PageRepository } from "../../infrastructure/repos/d1-page-repo";
import { serializePage, type SerializedPage } from "./render-section";

export interface AIGeneratedSections {
  sections: Array<{ type: string; variant: string; content: Record<string, unknown> }>;
  designTokens?: Record<string, string>;
}

export interface RegeneratePageInput {
  storeId: EntityId;
}

export interface RegeneratePageError {
  code: "PAGE_NOT_FOUND" | "AI_GENERATION_FAILED";
  message: string;
}

export type RegeneratePageOutput = SerializedPage;

export class RegeneratePage {
  constructor(
    private readonly pageRepo: PageRepository,
    private readonly aiGenerate: () => Promise<AIGeneratedSections>,
  ) {}

  async execute(input: RegeneratePageInput): Promise<Result<RegeneratePageOutput, RegeneratePageError>> {
    const existing = await this.pageRepo.findByStoreIdWithTokens(input.storeId);
    if (!existing) {
      return err({ code: "PAGE_NOT_FOUND", message: "Halaman tidak ditemukan." });
    }
    const { page } = existing;

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
        variant: s.variant,
        content: s.content,
        sortOrder: i,
      })
    );

    // Preserve user-chosen preferences the AI doesn't generate.
    const preserved: Record<string, string> = {};
    if (existing.designTokens?.navbarStyle) preserved.navbarStyle = existing.designTokens.navbarStyle;
    const designTokens = { ...(aiResult.designTokens ?? {}), ...preserved };

    page.replaceAll(sections);
    await this.pageRepo.save(page, designTokens);

    return ok(serializePage(page, designTokens));
  }
}
