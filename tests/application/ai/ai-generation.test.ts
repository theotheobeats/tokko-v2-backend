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
    findByStoreIdWithTokens: vi.fn().mockResolvedValue(page ? { page, designTokens: null } : null),
    save: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
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
      expect(result.value.sections).toHaveLength(2);
      expect(result.value.sections[0].type).toBe(SectionType.Hero);
      expect(result.value.sections[1].type).toBe(SectionType.About);
    }
    expect(repo.save).toHaveBeenCalledOnce();
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
