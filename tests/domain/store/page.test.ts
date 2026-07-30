import { describe, it, expect } from "vitest";
import { Page } from "../../../src/domain/store/page";
import { Section, SectionType } from "../../../src/domain/store/section";
import { createEntityId } from "../../../src/domain/shared/types";

const storeId = createEntityId();

function s(type: SectionType, label: string, order: number = 0): Section {
  return Section.create({ type, template: `<div>{{content}}</div>`, slots: { content: label }, sortOrder: order });
}

describe("Page entity", () => {
  describe("create()", () => {
    it("should create an empty page", () => {
      const page = Page.create(storeId);
      expect(page.id).toBeDefined();
      expect(page.storeId).toBe(storeId);
      expect(page.sections).toHaveLength(0);
    });

    it("should create a page with initial sections", () => {
      const sections = [s(SectionType.Hero, "H", 0), s(SectionType.About, "A", 1)];
      const page = Page.create(storeId, sections);
      expect(page.sections).toHaveLength(2);
    });
  });

  describe("addSection()", () => {
    it("should add a section at the end by default", () => {
      const page = Page.create(storeId);
      page.addSection(s(SectionType.Hero, "Hi"));
      expect(page.sections).toHaveLength(1);
      expect(page.sections[0].sortOrder).toBe(0);
    });

    it("should add section at specific position", () => {
      const s1 = s(SectionType.Hero, "1", 0);
      const s2 = s(SectionType.About, "2", 1);
      const page = Page.create(storeId, [s1, s2]);
      const s3 = s(SectionType.Cta, "3");
      page.addSection(s3, 1);
      expect(page.sections[0].type).toBe(SectionType.Hero);
      expect(page.sections[1].type).toBe(SectionType.Cta);
      expect(page.sections[2].type).toBe(SectionType.About);
    });
  });

  describe("removeSection()", () => {
    it("should remove a section by ID", () => {
      const s1 = s(SectionType.Hero, "1");
      const s2 = s(SectionType.About, "2");
      const page = Page.create(storeId, [s1, s2]);
      page.removeSection(s1.id);
      expect(page.sections).toHaveLength(1);
      expect(page.sections[0].id).toBe(s2.id);
    });
  });

  describe("moveSection()", () => {
    it("should move a section up", () => {
      const s1 = s(SectionType.Hero, "1", 0);
      const s2 = s(SectionType.About, "2", 1);
      const s3 = s(SectionType.Cta, "3", 2);
      const page = Page.create(storeId, [s1, s2, s3]);
      page.moveSection(2, 0);
      expect(page.sections[0].type).toBe(SectionType.Cta);
      expect(page.sections[1].type).toBe(SectionType.Hero);
      expect(page.sections[2].type).toBe(SectionType.About);
    });
  });

  describe("reorder()", () => {
    it("should reorder by ID list", () => {
      const s1 = s(SectionType.Hero, "1");
      const s2 = s(SectionType.About, "2");
      const s3 = s(SectionType.Cta, "3");
      const page = Page.create(storeId, [s1, s2, s3]);
      page.reorder([s3.id, s1.id, s2.id]);
      expect(page.sections[0].id).toBe(s3.id);
      expect(page.sections[1].id).toBe(s1.id);
      expect(page.sections[2].id).toBe(s2.id);
    });
  });

  describe("replaceAll()", () => {
    it("should replace all sections", () => {
      const page = Page.create(storeId, [s(SectionType.Hero, "old")]);
      const newSections = [s(SectionType.Faq, "new1"), s(SectionType.Contact, "new2")];
      page.replaceAll(newSections);
      expect(page.sections).toHaveLength(2);
      expect(page.sections[0].type).toBe(SectionType.Faq);
      expect(page.sections[1].type).toBe(SectionType.Contact);
    });
  });

  describe("from()", () => {
    it("should reconstitute from persistent props", () => {
      const id = createEntityId();
      const sectionId = createEntityId();
      const page = Page.from({
        id,
        storeId,
        sections: [{ id: sectionId, type: SectionType.Hero, template: "<div>{{title}}</div>", slots: { title: "Hi" }, sortOrder: 0 }],
      });
      expect(page.id).toBe(id);
      expect(page.sections).toHaveLength(1);
      expect(page.sections[0].type).toBe(SectionType.Hero);
    });
  });

  describe("toJSON()", () => {
    it("should return serializable snapshot", () => {
      const page = Page.create(storeId);
      page.addSection(s(SectionType.Hero, "Store"));
      const json = page.toJSON();
      expect(json.id).toBe(page.id);
      expect(json.sections).toHaveLength(1);
      expect(json.sections[0].type).toBe(SectionType.Hero);
    });
  });
});
