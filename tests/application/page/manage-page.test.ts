import { describe, it, expect, vi, beforeEach } from "vitest";
import { GetPage } from "../../../src/application/page/get-page";
import { UpdateSection } from "../../../src/application/page/update-section";
import { AddSection } from "../../../src/application/page/add-section";
import { RemoveSection } from "../../../src/application/page/remove-section";
import { ReorderSections } from "../../../src/application/page/reorder-sections";
import type { PageRepository } from "../../../src/infrastructure/repos/d1-page-repo";
import { Page } from "../../../src/domain/store/page";
import { Section, SectionType } from "../../../src/domain/store/section";
import { createEntityId } from "../../../src/domain/shared/types";

function mockPageRepo(overrides?: Partial<PageRepository>): PageRepository {
  const base: PageRepository = {
    findByStoreId: vi.fn().mockResolvedValue(null),
    findByStoreIdWithTokens: vi.fn().mockResolvedValue(null),
    save: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };

  // If a test overrides findByStoreId but not findByStoreIdWithTokens,
  // derive the tokens-aware variant from it (designTokens = null).
  if (overrides?.findByStoreId && !overrides?.findByStoreIdWithTokens) {
    base.findByStoreIdWithTokens = vi.fn(async (...args: any[]) => {
      const page = await (base.findByStoreId as any)(...args);
      return page ? { page, designTokens: null } : null;
    });
  }

  return base;
}

const storeId = createEntityId();

function s(type: SectionType, label: string, order: number = 0): Section {
  return Section.create({ type, variant: "default", content: { title: label }, sortOrder: order });
}

// ---------------------------------------------------------------------------
// GetPage
// ---------------------------------------------------------------------------
describe("GetPage use case", () => {
  it("should return page with sections", async () => {
    const page = Page.create(storeId, [s(SectionType.Hero, "H", 0), s(SectionType.About, "A", 1)]);
    const repo = mockPageRepo({ findByStoreId: vi.fn().mockResolvedValue(page) });
    const useCase = new GetPage(repo);
    const result = await useCase.execute({ storeId });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value!.sections).toHaveLength(2);
  });

  it("should return null when page not found", async () => {
    const repo = mockPageRepo();
    const useCase = new GetPage(repo);
    const result = await useCase.execute({ storeId });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBeNull();
  });

  it("should serialize page with structured sections and theme", async () => {
    const page = Page.create(storeId, [
      Section.create({
        type: SectionType.Hero,
        variant: "split",
        content: { title: "Hello" },
        sortOrder: 0,
      }),
    ]);
    const theme = { accent: "#e07b39", bg: "#f6f5f4" };
    const repo = mockPageRepo({
      findByStoreIdWithTokens: vi.fn().mockResolvedValue({ page, designTokens: theme }),
    });
    const useCase = new GetPage(repo);
    const result = await useCase.execute({ storeId });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const section = result.value!.sections[0] as any;
      // Component-based: no html — the frontend renders type+variant+content
      expect(section.html).toBeUndefined();
      expect(section.variant).toBe("split");
      expect(section.content.title).toBe("Hello");
      expect(result.value!.theme).toEqual(theme);
    }
  });
});

// ---------------------------------------------------------------------------
// UpdateSection
// ---------------------------------------------------------------------------
describe("UpdateSection use case", () => {
  let repo: PageRepository;
  let page: Page;

  beforeEach(() => {
    page = Page.create(storeId, [s(SectionType.Hero, "hero", 0), s(SectionType.About, "about", 1), s(SectionType.Cta, "cta", 2)]);
    repo = mockPageRepo({ findByStoreId: vi.fn().mockResolvedValue(page) });
  });

  it("should update a section's content", async () => {
    const useCase = new UpdateSection(repo);
    const targetSection = page.sections[0];
    const result = await useCase.execute({ storeId, sectionId: targetSection.id, content: { title: "Updated" } });
    expect(result.ok).toBe(true);
    if (result.ok) expect((result.value.section.content as any).title).toBe("Updated");
    expect(repo.save).toHaveBeenCalledOnce();
  });

  it("should return error when page not found", async () => {
    const emptyRepo = mockPageRepo();
    const useCase = new UpdateSection(emptyRepo);
    const result = await useCase.execute({ storeId, sectionId: createEntityId(), slots: { x: "y" } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("PAGE_NOT_FOUND");
  });

  it("should return error when section not found", async () => {
    const useCase = new UpdateSection(repo);
    const result = await useCase.execute({ storeId, sectionId: createEntityId(), slots: { x: "y" } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("SECTION_NOT_FOUND");
  });
});

// ---------------------------------------------------------------------------
// AddSection
// ---------------------------------------------------------------------------
describe("AddSection use case", () => {
  it("should add a new section", async () => {
    const page = Page.create(storeId, [s(SectionType.Hero, "h", 0), s(SectionType.About, "a", 1)]);
    const repo = mockPageRepo({ findByStoreId: vi.fn().mockResolvedValue(page) });
    const useCase = new AddSection(repo);
    const result = await useCase.execute({
      storeId, type: SectionType.Faq,
      template: "<div>{{q}}</div>", slots: { q: "Question?" }, sortOrder: 2,
    });
    expect(result.ok).toBe(true);
    expect(repo.save).toHaveBeenCalledOnce();
  });

  it("should return error when page not found", async () => {
    const repo = mockPageRepo();
    const useCase = new AddSection(repo);
    const result = await useCase.execute({ storeId, type: SectionType.Hero, template: "<div>{{x}}</div>", slots: { x: "y" } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("PAGE_NOT_FOUND");
  });
});

// ---------------------------------------------------------------------------
// RemoveSection
// ---------------------------------------------------------------------------
describe("RemoveSection use case", () => {
  it("should remove a section", async () => {
    const page = Page.create(storeId, [s(SectionType.Hero, "1"), s(SectionType.About, "2"), s(SectionType.Cta, "3")]);
    const repo = mockPageRepo({ findByStoreId: vi.fn().mockResolvedValue(page) });
    const useCase = new RemoveSection(repo);
    const result = await useCase.execute({ storeId, sectionId: page.sections[1].id });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.sections).toHaveLength(2);
    expect(repo.save).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// ReorderSections
// ---------------------------------------------------------------------------
describe("ReorderSections use case", () => {
  it("should reorder sections", async () => {
    const page = Page.create(storeId, [s(SectionType.Hero, "1", 0), s(SectionType.About, "2", 1), s(SectionType.Cta, "3", 2)]);
    const repo = mockPageRepo({ findByStoreId: vi.fn().mockResolvedValue(page) });
    const useCase = new ReorderSections(repo);
    const ids = page.sections.map((x) => x.id);
    const result = await useCase.execute({ storeId, sectionIds: [ids[2], ids[1], ids[0]] });
    expect(result.ok).toBe(true);
    expect(repo.save).toHaveBeenCalledOnce();
  });
});
