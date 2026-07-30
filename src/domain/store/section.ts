/**
 * Section value object — building block of a Page.
 *
 * Each section has a fixed type (hero, about, etc.), an AI-generated HTML
 * template with {{slotName}} placeholders, and editable slot values.
 * Users can change slot text; the template (HTML + CSS) stays AI-owned.
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
} as const;
export type SectionType = (typeof SectionType)[keyof typeof SectionType];

export interface SectionProps {
  id: EntityId;
  type: SectionType;
  template: string;        // HTML with {{slotKey}} placeholders and inline CSS
  slots: Record<string, string>;  // Editable text values
  sortOrder: number;
}

export class Section {
  private constructor(private readonly props: SectionProps) {}

  static create(params: {
    type: SectionType;
    template: string;
    slots: Record<string, string>;
    sortOrder?: number;
  }): Section {
    return new Section({
      id: createEntityId(),
      type: params.type,
      template: params.template,
      slots: { ...params.slots },
      sortOrder: params.sortOrder ?? 0,
    });
  }

  static from(props: SectionProps): Section {
    return new Section({ ...props });
  }

  get id() { return this.props.id; }
  get type() { return this.props.type; }
  get template() { return this.props.template; }
  get slots() { return { ...this.props.slots }; }
  get sortOrder() { return this.props.sortOrder; }

  /** Update a single slot value (user edits text) */
  updateSlot(key: string, value: string): Section {
    this.props.slots[key] = value;
    return this;
  }

  /** Update all slots at once */
  updateSlots(slots: Record<string, string>): Section {
    this.props.slots = { ...this.props.slots, ...slots };
    return this;
  }

  setSortOrder(order: number): Section {
    this.props.sortOrder = order;
    return this;
  }

  /** Get all slot keys found in the template */
  get slotKeys(): string[] {
    const matches = this.props.template.matchAll(/\{\{(\w+)\}\}/g);
    return Array.from(matches, (m) => m[1]);
  }

  /** Render the template with current slot values */
  render(): string {
    let html = this.props.template;
    for (const [key, value] of Object.entries(this.props.slots)) {
      html = html.replaceAll(`{{${key}}}`, value);
    }
    return html;
  }

  toJSON(): SectionProps {
    return {
      id: this.props.id,
      type: this.props.type,
      template: this.props.template,
      slots: { ...this.props.slots },
      sortOrder: this.props.sortOrder,
    };
  }
}
