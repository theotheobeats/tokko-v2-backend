/**
 * Default layout normalization for AI-generated sections.
 *
 * LLM output order is non-deterministic — the model occasionally emits the
 * hero last (and can skip the category strip entirely). This enforces the
 * platform's default page structure so onboarding AND editor regeneration
 * always produce a conversion-friendly layout:
 *
 *   1. hero         — always first
 *   2. category-grid — "Kategori" strip, directly below the hero
 *   3. everything else — original relative order preserved
 *
 * The category section is created when the AI omitted it and is always
 * forced to the minimal text-only strip block (`category-grid-strip`).
 * Stray duplicate hero / category-grid sections are dropped.
 */

import type { SectionType } from "../../domain/store/section";

export interface GeneratedSectionInput {
  type: string;
  variant: string;
  content: Record<string, unknown>;
}

/** The minimal letter-spaced category row that sits flush under the hero. */
export const CATEGORY_STRIP_BLOCK = "category-grid-strip";

export function normalizeGeneratedSections(
  sections: GeneratedSectionInput[],
): GeneratedSectionInput[] {
  const hero = sections.find((s) => s.type === "hero");
  // No hero at all — leave the order untouched rather than invent a layout.
  if (!hero) return sections;

  const category = sections.find((s) => s.type === "category-grid");
  const rest = sections.filter((s) => s.type !== "hero" && s.type !== "category-grid");

  return [
    { ...hero, content: { ...hero.content } },
    category
      ? { ...category, content: { ...category.content, blockId: CATEGORY_STRIP_BLOCK } }
      : { type: "category-grid" as SectionType, variant: "default", content: { blockId: CATEGORY_STRIP_BLOCK } },
    ...rest,
  ];
}
