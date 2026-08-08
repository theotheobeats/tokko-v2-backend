import { describe, it, expect, vi, beforeEach } from "vitest";
import { CreateProduct } from "../../../src/application/product/create-product";
import { UpdateProduct } from "../../../src/application/product/update-product";
import { GetProductBySlug } from "../../../src/application/product/get-product";
import { ListRelatedProducts } from "../../../src/application/product/list-related-products";
import type { ProductRepository } from "../../../src/infrastructure/repos/d1-product-repo";
import type { CategoryRepository } from "../../../src/infrastructure/repos/d1-category-repo";
import { Product } from "../../../src/domain/store/product";
import { ProductVariant } from "../../../src/domain/store/variant";
import { ProductCategory } from "../../../src/domain/store/category";
import { createEntityId } from "../../../src/domain/shared/types";

const storeId = createEntityId();

function makeProduct(name: string, overrides: Partial<{ price: number; categoryId: string | null }> = {}) {
  return Product.create({ storeId, name, price: overrides.price ?? 50000, categoryId: overrides.categoryId as any });
}

function mockRepo(overrides?: Partial<ProductRepository>): ProductRepository {
  return {
    findById: vi.fn().mockResolvedValue(null),
    findByStoreId: vi.fn().mockResolvedValue([]),
    findByStoreSlug: vi.fn().mockResolvedValue(null),
    findVariantsByProductIds: vi.fn().mockResolvedValue([]),
    replaceVariants: vi.fn().mockResolvedValue(undefined),
    deleteVariantsByProductId: vi.fn().mockResolvedValue(undefined),
    save: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    deleteByStoreId: vi.fn().mockResolvedValue(undefined),
    countByStoreId: vi.fn().mockResolvedValue(0),
    ...overrides,
  };
}

function mockCategoryRepo(overrides?: Partial<CategoryRepository>): CategoryRepository {
  return {
    findById: vi.fn().mockResolvedValue(null),
    findByStoreId: vi.fn().mockResolvedValue([]),
    findByStoreSlug: vi.fn().mockResolvedValue(null),
    save: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("CreateProduct marketplace fields", () => {
  let repo: ProductRepository;

  beforeEach(() => {
    repo = mockRepo();
  });

  it("auto-generates a unique slug from the name", async () => {
    const useCase = new CreateProduct(repo);
    const result = await useCase.execute({ storeId, name: "Blanket Pouch", price: 40000 });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.slug).toBe("blanket-pouch");
      expect(result.value.variants).toEqual([]);
    }
  });

  it("appends -2 when the slug is taken", async () => {
    (repo.findByStoreSlug as any).mockImplementation(async (_s: string, slug: string) =>
      slug === "blanket-pouch" ? makeProduct("Existing") : null,
    );
    const useCase = new CreateProduct(repo);
    const result = await useCase.execute({ storeId, name: "Blanket Pouch", price: 40000 });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.slug).toBe("blanket-pouch-2");
  });

  it("returns SLUG_TAKEN for an explicit conflicting slug", async () => {
    (repo.findByStoreSlug as any).mockResolvedValue(makeProduct("Other"));
    const useCase = new CreateProduct(repo);
    const result = await useCase.execute({ storeId, name: "Baru", price: 1000, slug: "other" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("SLUG_TAKEN");
  });

  it("rejects a category that does not belong to the store", async () => {
    const otherCategory = ProductCategory.create({ storeId: createEntityId(), name: "Lain" });
    const useCase = new CreateProduct(repo, mockCategoryRepo({ findById: vi.fn().mockResolvedValue(otherCategory) }));
    const result = await useCase.execute({ storeId, name: "Baru", price: 1000, categoryId: otherCategory.id });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("CATEGORY_NOT_FOUND");
  });

  it("saves variants with the product", async () => {
    const replaceVariants = vi.fn().mockResolvedValue(undefined);
    const useCase = new CreateProduct(mockRepo({ replaceVariants }));
    const result = await useCase.execute({
      storeId,
      name: "Selimut",
      price: 100000,
      variants: [{ name: "Ukuran S", price: 90000 }, { name: "Ukuran M" }],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.variants).toHaveLength(2);
      expect(result.value.variants[0].name).toBe("Ukuran S");
      expect(result.value.variants[1].price).toBeNull();
    }
    expect(replaceVariants).toHaveBeenCalledTimes(1);
  });
});

describe("UpdateProduct marketplace fields", () => {
  let repo: ProductRepository;

  beforeEach(() => {
    repo = mockRepo();
  });

  it("backfills a slug on first edit of a legacy product", async () => {
    const legacy = Product.create({ storeId, name: "Legacy Item", price: 5000 });
    // legacy products (pre-phase-2) have slug: null
    const legacyWithNullSlug = Product.from({ ...legacy.toJSON(), slug: null });
    (repo.findById as any).mockResolvedValue(legacyWithNullSlug);

    const useCase = new UpdateProduct(repo);
    const result = await useCase.execute({ productId: legacy.id, salePrice: 4000 });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.slug).toBe("legacy-item");
      expect(result.value.salePrice).toBe(4000);
    }
  });

  it("replaces variants when provided", async () => {
    const product = makeProduct("Dengan Varian");
    (repo.findById as any).mockResolvedValue(product);
    const replaceVariants = vi.fn().mockResolvedValue(undefined);
    const useCase = new UpdateProduct(mockRepo({ findById: vi.fn().mockResolvedValue(product), replaceVariants }));

    const result = await useCase.execute({
      productId: product.id,
      variants: [{ name: "Merah" }, { name: "Biru", price: 55000 }],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.variants.map((v) => v.name)).toEqual(["Merah", "Biru"]);
    }
    expect(replaceVariants).toHaveBeenCalledTimes(1);
  });
});

describe("GetProductBySlug", () => {
  it("returns the product with variants by store slug", async () => {
    const product = makeProduct("Sluggy");
    const variant = ProductVariant.create({ productId: product.id, name: "XL" });
    const repo = mockRepo({
      findByStoreSlug: vi.fn().mockResolvedValue(product),
      findVariantsByProductIds: vi.fn().mockResolvedValue([variant]),
    });

    const useCase = new GetProductBySlug(repo);
    const result = await useCase.execute({ storeId, slug: "sluggy" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).toBe(product.id);
      expect(result.value.variants[0].name).toBe("XL");
    }
  });

  it("returns NOT_FOUND for unknown slug", async () => {
    const useCase = new GetProductBySlug(mockRepo());
    const result = await useCase.execute({ storeId, slug: "nope" });
    expect(result.ok).toBe(false);
  });
});

describe("ListRelatedProducts category preference", () => {
  it("orders same-category products first", async () => {
    const catA = createEntityId();
    const catB = createEntityId();
    const current = makeProduct("Current", { categoryId: catA as any });
    const same = makeProduct("Same", { categoryId: catA as any });
    const other = makeProduct("Other", { categoryId: catB as any });
    const repo = mockRepo({
      findById: vi.fn().mockResolvedValue(current),
      findByStoreId: vi.fn().mockResolvedValue([other, same, current]),
    });

    const useCase = new ListRelatedProducts(repo);
    const result = await useCase.execute({ storeId, productId: current.id });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.map((p) => p.name)).toEqual(["Same", "Other"]);
    }
  });
});
