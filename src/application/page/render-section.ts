/**
 * Page serializer — the ONLY way sections/pages are sent to the frontend.
 *
 * The AI produces structured content (pure data); the frontend maps
 * (type + variant) → a designed component fed by content + theme.
 * There is NO HTML rendering on the backend anymore.
 */

import type { SectionProps } from "../../domain/store/section";
import type { Page } from "../../domain/store/page";
import type { EntityId } from "../../domain/shared/types";

/** A section DTO: structured content + the variant to render. */
export type SerializedSection = SectionProps;

/** A page DTO with its sections and theme (design tokens). */
export interface SerializedPage {
  id: EntityId;
  storeId: EntityId;
  slug: string;
  title: string | null;
  sections: SerializedSection[];
  theme: Record<string, string> | null;
}

/** Serialize a Page entity into the canonical API shape. */
export function serializePage(
  page: Page,
  theme?: Record<string, string> | null
): SerializedPage {
  return {
    id: page.id,
    storeId: page.storeId,
    slug: page.slug,
    title: page.title,
    sections: page.toJSON().sections,
    theme: theme ?? null,
  };
}
