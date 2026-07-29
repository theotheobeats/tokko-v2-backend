/**
 * Section value object — building block of a Page.
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

// Section data shapes per type
export interface HeroData {
  title: string;
  subtitle: string;
  ctaText: string;
}

export interface AboutData {
  heading: string;
  text: string;
}

export interface ProductGridData {
  heading: string;
}

export interface TestimonialData {
  heading: string;
  items: { name: string; text: string; rating: number }[];
}

export interface CtaData {
  heading: string;
  description: string;
  buttonText: string;
}

export interface ContactData {
  heading: string;
  whatsappNumber: string;
  address: string;
  hours: string;
}

export interface FaqData {
  heading: string;
  items: { question: string; answer: string }[];
}

export type SectionData =
  | HeroData
  | AboutData
  | ProductGridData
  | TestimonialData
  | CtaData
  | ContactData
  | FaqData;

export interface SectionProps {
  id: EntityId;
  type: SectionType;
  data: SectionData;
  sortOrder: number;
}

export class Section {
  private constructor(private readonly props: SectionProps) {}

  static create(type: SectionType, data: SectionData, sortOrder: number = 0): Section {
    return new Section({
      id: createEntityId(),
      type,
      data,
      sortOrder,
    });
  }

  static from(props: SectionProps): Section {
    return new Section({ ...props });
  }

  get id() { return this.props.id; }
  get type() { return this.props.type; }
  get data() { return this.props.data; }
  get sortOrder() { return this.props.sortOrder; }

  updateData(data: SectionData): Section {
    this.props.data = data;
    return this;
  }

  setSortOrder(order: number): Section {
    this.props.sortOrder = order;
    return this;
  }

  toJSON(): SectionProps {
    return { ...this.props };
  }
}
