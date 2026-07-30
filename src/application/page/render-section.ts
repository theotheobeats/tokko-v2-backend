/**
 * renderSection — produce final, ready-to-inject HTML for a section.
 *
 * Substitutes BOTH placeholder kinds into the AI-owned template:
 *   1. Slot values (user-editable text): {{title}}, {{subtitle}}, ...
 *   2. Design tokens (global theme):    {{bg}}, {{text}}, {{accent}}, ...
 *
 * The frontend receives `html` and injects it directly — it performs no
 * placeholder substitution of its own. `template`, `slots` and
 * `designTokens` are still sent separately so the editor can edit slot text
 * and re-request a render.
 */

import type { SectionProps } from "../../domain/store/section";
import type { Page } from "../../domain/store/page";
import type { EntityId } from "../../domain/shared/types";

export function renderSectionHtml(
  section: Pick<SectionProps, "template" | "slots">,
  designTokens?: Record<string, string> | null
): string {
  let html = section.template;

  // Slot values (section-specific, user-editable)
  for (const [key, value] of Object.entries(section.slots ?? {})) {
    html = html.replaceAll(`{{${key}}}`, value ?? "");
  }

  // Design tokens (global theme)
  for (const [key, value] of Object.entries(designTokens ?? {})) {
    html = html.replaceAll(`{{${key}}}`, value ?? "");
  }

  return html;
}

// ---------------------------------------------------------------------------
// Shared serializers — the ONLY way sections/pages should be sent to the
// frontend. Using these guarantees every section carries a rendered `html`.
// Any new endpoint that returns sections MUST go through serializePage /
// serializeSection so it can never forget the html field.
// ---------------------------------------------------------------------------

/** A section with its final, ready-to-inject `html` attached. */
export type RenderedSection = SectionProps & { html: string };

/** A page DTO with rendered sections and its design tokens. */
export interface RenderedPage {
  id: EntityId;
  storeId: EntityId;
  sections: RenderedSection[];
  designTokens: Record<string, string> | null;
}

/** Serialize a single section with rendered `html`. */
export function serializeSection(
  section: SectionProps,
  designTokens?: Record<string, string> | null
): RenderedSection {
  return { ...section, html: renderSectionHtml(section, designTokens) };
}

/**
 * Serialize a Page entity into the canonical API shape:
 * `{ id, storeId, sections[]+html, designTokens }`.
 */
export function serializePage(
  page: Page,
  designTokens?: Record<string, string> | null
): RenderedPage {
  const tokens = designTokens ?? null;
  return {
    id: page.id,
    storeId: page.storeId,
    sections: page.toJSON().sections.map((s) => serializeSection(s, tokens)),
    designTokens: tokens,
  };
}
