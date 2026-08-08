import { describe, it, expect, vi, beforeEach } from "vitest";
import { GenerateProductDescription } from "../../../src/application/product/generate-product-description";
import { RegeneratePage } from "../../../src/application/page/regenerate-page";
import type { PageRepository } from "../../../src/infrastructure/repos/d1-page-repo";
import { Page } from "../../../src/domain/store/page";
import { Section, SectionType } from "../../../src/domain/store/section";
import { createEntityId } from "../../../src/domain/shared/types";

const storeId = createEntityId();

function makePage() {
  return Page.create(storeId, [
    Section.create(SectionType.Hero, { title: "Old", subtitle: "Old", ctaText: "Old" }, 0),
  ]);
}

function mockPageRepo(page: Page | null = null): PageRepository {
  return {
    findByStoreId: vi.fn().mockResolvedValue(page),
    findByStoreIdAndSlug: vi.fn().mockResolvedValue(page),
    listByStoreId: vi.fn().mockResolvedValue(page ? [{ id: page.id, slug: page.slug, title: page.title }] : []),
    countByStoreId: vi.fn().mockResolvedValue(page ? 1 : 0),
    getDesignTokens: vi.fn().mockResolvedValue(null),
    saveDesignTokens: vi.fn().mockResolvedValue(undefined),
    save: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    deleteByStoreId: vi.fn().mockResolvedValue(undefined),
  };
}

// ---------------------------------------------------------------------------
// GenerateProductDescription
// ---------------------------------------------------------------------------

describe("GenerateProductDescription use case", () => {
  it("should return AI-generated description", async () => {
    const mockAI = vi.fn().mockResolvedValue(
      "Kue bolu pelangi lembut dengan lapisan krim keju premium."
    );
    const useCase = new GenerateProductDescription(mockAI);

    const result = await useCase.execute({
      name: "Rainbow Cake",
      category: "kue",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.description.toLowerCase()).toContain("kue bolu");
    }
    expect(mockAI).toHaveBeenCalledWith({
      name: "Rainbow Cake",
      category: "kue",
    });
  });

  it("should return error when AI fails", async () => {
    const mockAI = vi.fn().mockRejectedValue(new Error("API timeout"));
    const useCase = new GenerateProductDescription(mockAI);

    const result = await useCase.execute({
      name: "Rainbow Cake",
      category: "kue",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("AI_GENERATION_FAILED");
    }
  });

  it("should trim the description", async () => {
    const mockAI = vi.fn().mockResolvedValue("  Short description.  ");
    const useCase = new GenerateProductDescription(mockAI);

    const result = await useCase.execute({ name: "X", category: "y" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.description).toBe("Short description.");
    }
  });
});

// ---------------------------------------------------------------------------
// RegeneratePage
// ---------------------------------------------------------------------------

describe("RegeneratePage use case", () => {
  let repo: PageRepository;
  let mockAI: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    repo = mockPageRepo(makePage());
    mockAI = vi.fn().mockResolvedValue({
      sections: [
        { type: "hero", data: { title: "New Hero", subtitle: "New Sub", ctaText: "New CTA" } },
        { type: "about", data: { heading: "New About", text: "New text" } },
      ],
    });
  });

  it("should replace all sections with AI-generated ones", async () => {
    const useCase = new RegeneratePage(repo, mockAI);

    const result = await useCase.execute({ storeId });

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Default layout is enforced: hero first, Kategori strip second, rest after.
      expect(result.value.sections).toHaveLength(3);
      expect(result.value.sections[0].type).toBe(SectionType.Hero);
      expect(result.value.sections[1].type).toBe(SectionType.CategoryGrid);
      expect(result.value.sections[1].content.blockId).toBe("category-grid-strip");
      expect(result.value.sections[2].type).toBe(SectionType.About);
    }
    expect(repo.save).toHaveBeenCalledOnce();
  });

  it("moves hero to the top and inserts the Kategori strip when the AI emits hero last", async () => {
    mockAI.mockResolvedValue({
      sections: [
        { type: "about", variant: "default", content: { heading: "About" } },
        { type: "footer", variant: "default", content: { heading: "Footer" } },
        { type: "hero", variant: "default", content: { blockId: "hero-slideshow", slides: [] } },
      ],
    });
    const useCase = new RegeneratePage(repo, mockAI);

    const result = await useCase.execute({ storeId });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.sections.map((s) => s.type)).toEqual([
        SectionType.Hero,
        SectionType.CategoryGrid,
        SectionType.About,
        SectionType.Footer,
      ]);
    }
  });

  it("forces an AI-provided category section to the strip block and de-duplicates it", async () => {
    mockAI.mockResolvedValue({
      sections: [
        { type: "hero", variant: "default", content: { blockId: "hero-slideshow", slides: [] } },
        { type: "category-grid", variant: "default", content: { blockId: "category-grid-cards" } },
        { type: "category-grid", variant: "default", content: { blockId: "category-grid-strip" } },
        { type: "about", variant: "default", content: { heading: "About" } },
      ],
    });
    const useCase = new RegeneratePage(repo, mockAI);

    const result = await useCase.execute({ storeId });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const types = result.value.sections.map((s) => s.type);
      expect(types).toEqual([SectionType.Hero, SectionType.CategoryGrid, SectionType.About]);
      // The kept category section is forced to the strip block.
      expect(result.value.sections[1].content.blockId).toBe("category-grid-strip");
    }
  });

  it("should return error when page not found", async () => {
    const emptyRepo = mockPageRepo();
    const useCase = new RegeneratePage(emptyRepo, mockAI);

    const result = await useCase.execute({ storeId });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("PAGE_NOT_FOUND");
  });

  it("should return error when AI fails", async () => {
    mockAI.mockRejectedValue(new Error("AI error"));
    const useCase = new RegeneratePage(repo, mockAI);

    const result = await useCase.execute({ storeId });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AI_GENERATION_FAILED");
    expect(repo.save).not.toHaveBeenCalled();
  });
});
