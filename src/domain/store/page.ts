/**
 * Page entity — contains ordered sections. Belongs to Store aggregate.
 * A store has multiple pages, identified by `slug` ("beranda" is home).
 */

import type { EntityId } from "../shared/types";
import { createEntityId } from "../shared/types";
import { Section, type SectionProps } from "./section";

export interface PageProps {
  id: EntityId;
  storeId: EntityId;
  slug: string;
  title: string | null;
  sections: Section[];
}

/** Reserved slug — every store's home page. */
export const HOME_SLUG = "beranda";

/** Maximum pages a store can have (home page included). */
export const MAX_PAGES = 5;

export class Page {
  private constructor(private readonly props: PageProps) {}

  static create(
    storeId: EntityId,
    sections: Section[] = [],
    slug: string = HOME_SLUG,
    title: string | null = null
  ): Page {
    return new Page({
      id: createEntityId(),
      storeId,
      slug: slug.trim() || HOME_SLUG,
      title: title?.trim() || null,
      sections: [...sections],
    });
  }

  static from(props: Omit<PageProps, 'sections'> & { sections: SectionProps[] }): Page {
    return new Page({
      id: props.id,
      storeId: props.storeId,
      slug: props.slug ?? HOME_SLUG,
      title: props.title ?? null,
      sections: props.sections.map((s) => Section.from(s)),
    });
  }

  get id() { return this.props.id; }
  get storeId() { return this.props.storeId; }
  get slug() { return this.props.slug; }
  get title() { return this.props.title; }
  get sections() { return [...this.props.sections]; }

  /** Rename the page (slug + display title). */
  rename(slug: string, title?: string | null): Page {
    this.props.slug = slug.trim() || HOME_SLUG;
    this.props.title = title?.trim() || null;
    return this;
  }

  /** Add a section at a specific position (or end) */
  addSection(section: Section, position?: number): Page {
    if (position !== undefined) {
      this.props.sections.splice(position, 0, section);
    } else {
      this.props.sections.push(section);
    }
    this._renumberSections();
    return this;
  }

  /** Remove a section by ID */
  removeSection(sectionId: EntityId): Page {
    this.props.sections = this.props.sections.filter((s) => s.id !== sectionId);
    this._renumberSections();
    return this;
  }

  /** Move a section from one position to another */
  moveSection(fromIndex: number, toIndex: number): Page {
    if (fromIndex < 0 || fromIndex >= this.props.sections.length) return this;
    if (toIndex < 0 || toIndex >= this.props.sections.length) return this;

    const [section] = this.props.sections.splice(fromIndex, 1);
    this.props.sections.splice(toIndex, 0, section);
    this._renumberSections();
    return this;
  }

  /** Reorder sections by a new list of IDs */
  reorder(sectionIds: EntityId[]): Page {
    const lookup = new Map(this.props.sections.map((s) => [s.id, s]));
    this.props.sections = sectionIds
      .map((id) => lookup.get(id))
      .filter((s): s is Section => s !== undefined);
    this._renumberSections();
    return this;
  }

  /** Replace all sections (for AI regeneration) */
  replaceAll(sections: Section[]): Page {
    this.props.sections = [...sections];
    this._renumberSections();
    return this;
  }

  private _renumberSections(): void {
    this.props.sections.forEach((s, i) => s.setSortOrder(i));
  }

  toJSON(): Omit<PageProps, 'sections'> & { sections: SectionProps[] } {
    return {
      id: this.props.id,
      storeId: this.props.storeId,
      slug: this.props.slug,
      title: this.props.title,
      sections: this.props.sections.map((s) => s.toJSON()),
    };
  }
}
