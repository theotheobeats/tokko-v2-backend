/**
 * Section value object — building block of a Page.
 *
 * A section is STRUCTURED CONTENT, not HTML. It has:
 *   - type:    which kind of section (hero, about, ...)
 *   - variant: which designed component the frontend should render
 *   - content: typed data for that component (heading, items, ...)
 *
 * The frontend maps (type + variant) → a hand-designed component and feeds
 * it `content` + the page `theme`. The AI only ever produces data — never
 * markup — so output is always renderable and on-brand.
 */

import type { EntityId } from "../shared/types";
import { createEntityId } from "../shared/types";

export const SectionType = {
  Hero: "hero",
  About: "about",
  ProductGrid: "product-grid",
  Testimonial: "testimonial",
  Cta: "cta",
  Contact: "contact",
  Faq: "faq",
  Footer: "footer",
} as const;
export type SectionType = (typeof SectionType)[keyof typeof SectionType];

export interface SectionProps {
  id: EntityId;
  type: SectionType;
  variant: string;
  content: Record<string, unknown>;
  sortOrder: number;
}

export class Section {
  private constructor(private readonly props: SectionProps) {}

  static create(params: {
    type: SectionType;
    variant: string;
    content: Record<string, unknown>;
    sortOrder?: number;
  }): Section {
    return new Section({
      id: createEntityId(),
      type: params.type,
      variant: params.variant,
      content: { ...params.content },
      sortOrder: params.sortOrder ?? 0,
    });
  }

  static from(props: SectionProps): Section {
    return new Section({ ...props, content: { ...props.content } });
  }

  get id() { return this.props.id; }
  get type() { return this.props.type; }
  get variant() { return this.props.variant; }
  get content() { return { ...this.props.content }; }
  get sortOrder() { return this.props.sortOrder; }

  /** Replace the section's content (user edits copy via the editor). */
  updateContent(content: Record<string, unknown>): Section {
    this.props.content = { ...this.props.content, ...content };
    return this;
  }

  setVariant(variant: string): Section {
    this.props.variant = variant;
    return this;
  }

  setSortOrder(order: number): Section {
    this.props.sortOrder = order;
    return this;
  }

  toJSON(): SectionProps {
    return {
      id: this.props.id,
      type: this.props.type,
      variant: this.props.variant,
      content: { ...this.props.content },
      sortOrder: this.props.sortOrder,
    };
  }
}
