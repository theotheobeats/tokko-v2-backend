/**
 * RegeneratePage use case — AI regenerates all sections of a page.
 * The visual theme is site-wide (store level); a page regeneration may
 * produce a new theme, which is saved to the store.
 */

import type { EntityId } from "../../domain/shared/types";
import type { Result } from "../../domain/shared/types";
import { ok, err } from "../../domain/shared/types";
import { Section, type SectionType } from "../../domain/store/section";
import { HOME_SLUG } from "../../domain/store/page";
import type { PageRepository } from "../../infrastructure/repos/d1-page-repo";
import { serializePage, type SerializedPage } from "./render-section";
import { normalizeGeneratedSections } from "./normalize-sections";

export interface AIGeneratedSections {
  sections: Array<{ type: string; variant: string; content: Record<string, unknown> }>;
  designTokens?: Record<string, string>;
}

export interface RegeneratePageInput {
  storeId: EntityId;
  slug?: string;
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
    const page = await this.pageRepo.findByStoreIdAndSlug(input.storeId, input.slug ?? HOME_SLUG);
    if (!page) {
      return err({ code: "PAGE_NOT_FOUND", message: "Halaman tidak ditemukan." });
    }
    const previousTokens = await this.pageRepo.getDesignTokens(input.storeId);

    let aiResult: AIGeneratedSections;
    try {
      aiResult = await this.aiGenerate();
    } catch (error: any) {
      return err({
        code: "AI_GENERATION_FAILED",
        message: error?.message ?? "Gagal membuat ulang halaman.",
      });
    }

    // Enforce the default layout: hero first, Kategori strip second, then
    // the rest in AI order (the model sometimes emits hero last / skips the
    // category strip — normalize before persisting).
    const ordered = normalizeGeneratedSections(aiResult.sections);
    const sections = ordered.map((s, i) =>
      Section.create({
        type: s.type as SectionType,
        variant: s.variant,
        content: s.content,
        sortOrder: i,
      })
    );

    // Preserve user-chosen preferences the AI doesn't generate.
    const preserved: Record<string, string> = {};
    if (previousTokens?.navbarStyle) preserved.navbarStyle = previousTokens.navbarStyle;
    const designTokens = { ...(aiResult.designTokens ?? {}), ...preserved };
    // The editorial navbar is the platform default — force it when unset.
    if (!designTokens.navbarStyle) designTokens.navbarStyle = "navbar-editorial";

    page.replaceAll(sections);
    await this.pageRepo.save(page);
    if (aiResult.designTokens) {
      await this.pageRepo.saveDesignTokens(input.storeId, designTokens);
    }

    return ok(serializePage(page, designTokens));
  }
}
