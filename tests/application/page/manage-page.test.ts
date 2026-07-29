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
  return {
    findByStoreId: vi.fn().mockResolvedValue(null),
    save: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

const storeId = createEntityId();

function makePage(sectionCount = 3) {
  const sections = Array.from({ length: sectionCount }, (_, i) =>
    Section.create(
      i === 0 ? SectionType.Hero : i === 1 ? SectionType.About : SectionType.Cta,
      i === 0 ? { title: `Hero ${i}`, subtitle: "S", ctaText: "C" } :
      i === 1 ? { heading: `About ${i}`, text: "T" } :
                { heading: `CTA ${i}`, description: "D", buttonText: "B" },
      i
    )
  );
  return Page.create(storeId, sections);
}

// ---------------------------------------------------------------------------
// GetPage
// ---------------------------------------------------------------------------

describe("GetPage use case", () => {
  it("should return page with sections", async () => {
    const page = makePage(2);
    const repo = mockPageRepo({ findByStoreId: vi.fn().mockResolvedValue(page) });
    const useCase = new GetPage(repo);

    const result = await useCase.execute({ storeId });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.sections).toHaveLength(2);
      expect(result.value.sections[0].type).toBe(SectionType.Hero);
    }
  });

  it("should return null when page not found", async () => {
    const repo = mockPageRepo();
    const useCase = new GetPage(repo);

    const result = await useCase.execute({ storeId });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBeNull();
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
    page = makePage(3);
    repo = mockPageRepo({ findByStoreId: vi.fn().mockResolvedValue(page) });
  });

  it("should update a section's data", async () => {
    const useCase = new UpdateSection(repo);
    const targetSection = page.sections[0];

    const result = await useCase.execute({
      storeId,
      sectionId: targetSection.id,
      data: { title: "Updated Title", subtitle: "New Sub", ctaText: "New CTA" },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.data).toEqual({ title: "Updated Title", subtitle: "New Sub", ctaText: "New CTA" });
    }
    expect(repo.save).toHaveBeenCalledOnce();
  });

  it("should return error when page not found", async () => {
    const emptyRepo = mockPageRepo();
    const useCase = new UpdateSection(emptyRepo);

    const result = await useCase.execute({
      storeId,
      sectionId: createEntityId(),
      data: { title: "X" },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("PAGE_NOT_FOUND");
  });

  it("should return error when section not found", async () => {
    const useCase = new UpdateSection(repo);

    const result = await useCase.execute({
      storeId,
      sectionId: createEntityId(),
      data: { title: "X" },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("SECTION_NOT_FOUND");
  });
});

// ---------------------------------------------------------------------------
// AddSection
// ---------------------------------------------------------------------------

describe("AddSection use case", () => {
  it("should add a new section to the page", async () => {
    const page = makePage(2);
    const repo = mockPageRepo({ findByStoreId: vi.fn().mockResolvedValue(page) });
    const useCase = new AddSection(repo);

    const result = await useCase.execute({
      storeId,
      type: SectionType.Faq,
      data: { heading: "FAQ", items: [] },
      sortOrder: 2,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.sections).toHaveLength(3);
      expect(result.value.sections[2].type).toBe(SectionType.Faq);
    }
    expect(repo.save).toHaveBeenCalledOnce();
  });

  it("should return error when page not found", async () => {
    const repo = mockPageRepo();
    const useCase = new AddSection(repo);

    const result = await useCase.execute({
      storeId,
      type: SectionType.Hero,
      data: { title: "Hi" },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("PAGE_NOT_FOUND");
  });
});

// ---------------------------------------------------------------------------
// RemoveSection
// ---------------------------------------------------------------------------

describe("RemoveSection use case", () => {
  it("should remove a section", async () => {
    const page = makePage(3);
    const repo = mockPageRepo({ findByStoreId: vi.fn().mockResolvedValue(page) });
    const useCase = new RemoveSection(repo);
    const targetSection = page.sections[1];

    const result = await useCase.execute({
      storeId,
      sectionId: targetSection.id,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.sections).toHaveLength(2);
    }
    expect(repo.save).toHaveBeenCalledOnce();
  });

  it("should return error when page not found", async () => {
    const repo = mockPageRepo();
    const useCase = new RemoveSection(repo);

    const result = await useCase.execute({ storeId, sectionId: createEntityId() });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("PAGE_NOT_FOUND");
  });
});

// ---------------------------------------------------------------------------
// ReorderSections
// ---------------------------------------------------------------------------

describe("ReorderSections use case", () => {
  it("should reorder sections by ID list", async () => {
    const page = makePage(3);
    const repo = mockPageRepo({ findByStoreId: vi.fn().mockResolvedValue(page) });
    const useCase = new ReorderSections(repo);

    const ids = page.sections.map((s) => s.id);
    const reversed = [ids[2], ids[1], ids[0]];

    const result = await useCase.execute({
      storeId,
      sectionIds: reversed,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.sections[0].sortOrder).toBe(0);
      expect(result.value.sections[1].sortOrder).toBe(1);
      expect(result.value.sections[2].sortOrder).toBe(2);
    }
    expect(repo.save).toHaveBeenCalledOnce();
  });

  it("should return error when page not found", async () => {
    const repo = mockPageRepo();
    const useCase = new ReorderSections(repo);

    const result = await useCase.execute({ storeId, sectionIds: [] });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("PAGE_NOT_FOUND");
  });
});
