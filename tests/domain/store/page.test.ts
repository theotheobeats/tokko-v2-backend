import { describe, it, expect } from "vitest";
import { Page } from "../../../src/domain/store/page";
import { Section, SectionType } from "../../../src/domain/store/section";
import { createEntityId } from "../../../src/domain/shared/types";

const storeId = createEntityId();

describe("Section value object", () => {
  describe("create()", () => {
    it("should create a hero section with data", () => {
      const section = Section.create(SectionType.Hero, {
        title: "Welcome",
        subtitle: "Best bakery",
        ctaText: "Order Now",
      }, 0);

      expect(section.id).toBeDefined();
      expect(section.type).toBe(SectionType.Hero);
      expect(section.sortOrder).toBe(0);
      expect(section.data).toEqual({
        title: "Welcome",
        subtitle: "Best bakery",
        ctaText: "Order Now",
      });
    });

    it("should create each section type", () => {
      const types = [
        SectionType.Hero,
        SectionType.About,
        SectionType.ProductGrid,
        SectionType.Testimonial,
        SectionType.Cta,
        SectionType.Contact,
        SectionType.Faq,
      ];

      for (const type of types) {
        const section = Section.create(type, { heading: "Test" } as any);
        expect(section.type).toBe(type);
      }
    });
  });

  describe("updateData()", () => {
    it("should update the section data", () => {
      const section = Section.create(SectionType.Hero, {
        title: "Old Title",
        subtitle: "Old Subtitle",
        ctaText: "Old CTA",
      }, 0);

      section.updateData({
        title: "New Title",
        subtitle: "New Subtitle",
        ctaText: "New CTA",
      });

      expect(section.data).toEqual({
        title: "New Title",
        subtitle: "New Subtitle",
        ctaText: "New CTA",
      });
    });
  });

  describe("setSortOrder()", () => {
    it("should change sort order", () => {
      const section = Section.create(SectionType.Hero, { title: "Hi" } as any, 5);
      expect(section.sortOrder).toBe(5);
      section.setSortOrder(10);
      expect(section.sortOrder).toBe(10);
    });
  });

  describe("from()", () => {
    it("should reconstitute from props", () => {
      const id = createEntityId();
      const section = Section.from({
        id,
        type: SectionType.Faq,
        data: { heading: "FAQ", items: [] },
        sortOrder: 3,
      });

      expect(section.id).toBe(id);
      expect(section.type).toBe(SectionType.Faq);
      expect(section.sortOrder).toBe(3);
    });
  });
});

describe("Page entity", () => {
  describe("create()", () => {
    it("should create an empty page", () => {
      const page = Page.create(storeId);

      expect(page.id).toBeDefined();
      expect(page.storeId).toBe(storeId);
      expect(page.sections).toHaveLength(0);
    });

    it("should create a page with initial sections", () => {
      const sections = [
        Section.create(SectionType.Hero, { title: "H" } as any, 0),
        Section.create(SectionType.About, { text: "A" } as any, 1),
      ];

      const page = Page.create(storeId, sections);
      expect(page.sections).toHaveLength(2);
    });
  });

  describe("addSection()", () => {
    it("should add a section at the end by default", () => {
      const page = Page.create(storeId);
      const section = Section.create(SectionType.Hero, { title: "Hi" } as any);

      page.addSection(section);
      expect(page.sections).toHaveLength(1);
      expect(page.sections[0].sortOrder).toBe(0);
    });

    it("should add a section at a specific position", () => {
      const s1 = Section.create(SectionType.Hero, { title: "1" } as any, 0);
      const s2 = Section.create(SectionType.About, { text: "2" } as any, 1);
      const page = Page.create(storeId, [s1, s2]);

      const s3 = Section.create(SectionType.Cta, { heading: "3" } as any);
      page.addSection(s3, 1); // insert between s1 and s2

      expect(page.sections).toHaveLength(3);
      expect(page.sections[0].type).toBe(SectionType.Hero);
      expect(page.sections[1].type).toBe(SectionType.Cta);
      expect(page.sections[2].type).toBe(SectionType.About);
      expect(page.sections[0].sortOrder).toBe(0);
      expect(page.sections[1].sortOrder).toBe(1);
      expect(page.sections[2].sortOrder).toBe(2);
    });
  });

  describe("removeSection()", () => {
    it("should remove a section by ID", () => {
      const s1 = Section.create(SectionType.Hero, { title: "1" } as any);
      const s2 = Section.create(SectionType.About, { text: "2" } as any);
      const page = Page.create(storeId, [s1, s2]);

      page.removeSection(s1.id);
      expect(page.sections).toHaveLength(1);
      expect(page.sections[0].id).toBe(s2.id);
      expect(page.sections[0].sortOrder).toBe(0); // renumbered
    });

    it("should do nothing if section ID not found", () => {
      const s1 = Section.create(SectionType.Hero, { title: "1" } as any);
      const page = Page.create(storeId, [s1]);

      page.removeSection(createEntityId());
      expect(page.sections).toHaveLength(1);
    });
  });

  describe("moveSection()", () => {
    it("should move a section up", () => {
      const s1 = Section.create(SectionType.Hero, { title: "1" } as any, 0);
      const s2 = Section.create(SectionType.About, { text: "2" } as any, 1);
      const s3 = Section.create(SectionType.Cta, { heading: "3" } as any, 2);
      const page = Page.create(storeId, [s1, s2, s3]);

      page.moveSection(2, 0); // move CTA (index 2) to top (index 0)

      expect(page.sections[0].type).toBe(SectionType.Cta);
      expect(page.sections[1].type).toBe(SectionType.Hero);
      expect(page.sections[2].type).toBe(SectionType.About);
    });

    it("should do nothing for out-of-bounds indices", () => {
      const s1 = Section.create(SectionType.Hero, { title: "1" } as any);
      const page = Page.create(storeId, [s1]);

      page.moveSection(-1, 0);
      expect(page.sections[0].type).toBe(SectionType.Hero);

      page.moveSection(0, 999);
      expect(page.sections[0].type).toBe(SectionType.Hero);
    });
  });

  describe("reorder()", () => {
    it("should reorder by ID list", () => {
      const s1 = Section.create(SectionType.Hero, { title: "1" } as any, 0);
      const s2 = Section.create(SectionType.About, { text: "2" } as any, 1);
      const s3 = Section.create(SectionType.Cta, { heading: "3" } as any, 2);
      const page = Page.create(storeId, [s1, s2, s3]);

      page.reorder([s3.id, s1.id, s2.id]);

      expect(page.sections[0].id).toBe(s3.id);
      expect(page.sections[1].id).toBe(s1.id);
      expect(page.sections[2].id).toBe(s2.id);
      expect(page.sections[0].sortOrder).toBe(0);
      expect(page.sections[1].sortOrder).toBe(1);
      expect(page.sections[2].sortOrder).toBe(2);
    });

    it("should ignore IDs not found in page", () => {
      const s1 = Section.create(SectionType.Hero, { title: "1" } as any);
      const s2 = Section.create(SectionType.About, { text: "2" } as any);
      const page = Page.create(storeId, [s1, s2]);

      page.reorder([createEntityId(), s2.id, s1.id]);

      expect(page.sections).toHaveLength(2);
      expect(page.sections[0].id).toBe(s2.id);
      expect(page.sections[1].id).toBe(s1.id);
    });
  });

  describe("replaceAll()", () => {
    it("should replace all sections", () => {
      const s1 = Section.create(SectionType.Hero, { title: "1" } as any);
      const page = Page.create(storeId, [s1]);

      const newSections = [
        Section.create(SectionType.Faq, { heading: "FAQ" } as any),
        Section.create(SectionType.Contact, { heading: "Contact" } as any),
      ];

      page.replaceAll(newSections);
      expect(page.sections).toHaveLength(2);
      expect(page.sections[0].type).toBe(SectionType.Faq);
      expect(page.sections[1].type).toBe(SectionType.Contact);
      expect(page.sections[0].sortOrder).toBe(0);
      expect(page.sections[1].sortOrder).toBe(1);
    });
  });

  describe("from()", () => {
    it("should reconstitute from persistent props", () => {
      const id = createEntityId();
      const sectionId = createEntityId();
      const page = Page.from({
        id,
        storeId,
        sections: [{
          id: sectionId,
          type: SectionType.Hero,
          data: { title: "Hi" } as any,
          sortOrder: 0,
        }],
      });

      expect(page.id).toBe(id);
      expect(page.sections).toHaveLength(1);
      expect(page.sections[0].type).toBe(SectionType.Hero);
    });
  });

  describe("toJSON()", () => {
    it("should return serializable snapshot", () => {
      const page = Page.create(storeId);
      page.addSection(Section.create(SectionType.Hero, { title: "Store" } as any));

      const json = page.toJSON();
      expect(json.id).toBe(page.id);
      expect(json.sections).toHaveLength(1);
      expect(json.sections[0].type).toBe(SectionType.Hero);
    });
  });
});
