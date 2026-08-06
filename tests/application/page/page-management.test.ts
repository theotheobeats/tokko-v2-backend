import { describe, it, expect, vi } from "vitest";
import {
  AddPage,
  UpdatePage,
  DeletePage,
  PageSlugInvalidError,
  PageSlugTakenError,
  PageNotFoundError,
  LastPageError,
} from "../../../src/application/page/page-management";
import type { PageRepository } from "../../../src/infrastructure/repos/d1-page-repo";
import { Page } from "../../../src/domain/store/page";
import { createEntityId } from "../../../src/domain/shared/types";

const storeId = createEntityId();

function mockPageRepo(overrides?: Partial<PageRepository>): PageRepository {
  return {
    findByStoreId: vi.fn().mockResolvedValue(null),
    findByStoreIdAndSlug: vi.fn().mockResolvedValue(null),
    listByStoreId: vi.fn().mockResolvedValue([]),
    countByStoreId: vi.fn().mockResolvedValue(1),
    getDesignTokens: vi.fn().mockResolvedValue(null),
    saveDesignTokens: vi.fn().mockResolvedValue(undefined),
    save: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    deleteByStoreId: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("AddPage", () => {
  it("should create a page with the requested slug", async () => {
    const repo = mockPageRepo();
    const result = await new AddPage(repo).execute({ storeId, slug: "tentang", title: "Tentang Kami" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.page.slug).toBe("tentang");
      expect(result.value.page.title).toBe("Tentang Kami");
    }
    expect(repo.save).toHaveBeenCalledTimes(1);
  });

  it("should seed template sections", async () => {
    const repo = mockPageRepo();
    const about = await new AddPage(repo).execute({ storeId, slug: "tentang", template: "about" });
    expect(about.ok).toBe(true);
    if (about.ok) {
      const types = about.value.page.sections.map((s: any) => s.type);
      expect(types).toEqual(["about", "cta", "contact"]);
    }

    const products = await new AddPage(repo).execute({ storeId, slug: "produk", template: "products" });
    expect(products.ok).toBe(true);
    if (products.ok) expect(products.value.page.sections).toHaveLength(1);

    const empty = await new AddPage(repo).execute({ storeId, slug: "kosong", template: "empty" });
    expect(empty.ok).toBe(true);
    if (empty.ok) expect(empty.value.page.sections).toHaveLength(0);
  });

  it("should reject a duplicate slug", async () => {
    const existing = Page.create(storeId, [], "tentang");
    const repo = mockPageRepo({ findByStoreIdAndSlug: vi.fn().mockResolvedValue(existing) });
    const result = await new AddPage(repo).execute({ storeId, slug: "tentang" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(PageSlugTakenError);
  });

  it("should reject invalid slugs and the reserved home slug", async () => {
    const repo = mockPageRepo();
    for (const slug of ["beranda", "Bad Slug", "a", "with_underscore", "trailing-", ""]) {
      const result = await new AddPage(repo).execute({ storeId, slug });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBeInstanceOf(PageSlugInvalidError);
    }
  });
});

describe("UpdatePage", () => {
  it("should rename slug + title", async () => {
    const page = Page.create(storeId, [], "tentang", "Tentang");
    const repo = mockPageRepo({
      findByStoreIdAndSlug: vi.fn(async (_s: any, slug: string) => (slug === "tentang" ? page : null)),
    });
    const result = await new UpdatePage(repo).execute({ storeId, slug: "tentang", newSlug: "tentang-kami", title: "Tentang Kami" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.page.slug).toBe("tentang-kami");
      expect(result.value.page.title).toBe("Tentang Kami");
    }
  });

  it("should reject a clashing new slug", async () => {
    const page = Page.create(storeId, [], "tentang");
    const clash = Page.create(storeId, [], "produk");
    const repo = mockPageRepo({
      findByStoreIdAndSlug: vi.fn(async (_s: any, slug: string) => (slug === "tentang" ? page : slug === "produk" ? clash : null)),
    });
    const result = await new UpdatePage(repo).execute({ storeId, slug: "tentang", newSlug: "produk" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(PageSlugTakenError);
  });

  it("should return not-found for unknown pages", async () => {
    const repo = mockPageRepo();
    const result = await new UpdatePage(repo).execute({ storeId, slug: "missing" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(PageNotFoundError);
  });
});

describe("DeletePage", () => {
  it("should delete a page and return the remaining list", async () => {
    const page = Page.create(storeId, [], "tentang");
    const repo = mockPageRepo({
      findByStoreIdAndSlug: vi.fn().mockResolvedValue(page),
      countByStoreId: vi.fn().mockResolvedValue(2),
      listByStoreId: vi.fn().mockResolvedValue([{ id: createEntityId(), slug: "beranda", title: null }]),
    });
    const result = await new DeletePage(repo).execute({ storeId, slug: "tentang" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.pages).toHaveLength(1);
    expect(repo.delete).toHaveBeenCalledWith(page.id);
  });

  it("should refuse to delete the last page", async () => {
    const page = Page.create(storeId, [], "beranda");
    const repo = mockPageRepo({
      findByStoreIdAndSlug: vi.fn().mockResolvedValue(page),
      countByStoreId: vi.fn().mockResolvedValue(1),
    });
    const result = await new DeletePage(repo).execute({ storeId, slug: "beranda" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(LastPageError);
    expect(repo.delete).not.toHaveBeenCalled();
  });
});
