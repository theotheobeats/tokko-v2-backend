import { describe, it, expect, vi, beforeEach } from "vitest";
import { ListProducts } from "../../../src/application/product/list-products";
import type { ProductRepository } from "../../../src/infrastructure/repos/d1-product-repo";
import { Product } from "../../../src/domain/store/product";
import { createEntityId } from "../../../src/domain/shared/types";

const storeId = createEntityId();
const catA = createEntityId();
const catB = createEntityId();

function makeProduct(name: string, overrides: Partial<{ price: number; salePrice: number | null; categoryId: string | null; createdAt: string }> = {}) {
  const p = Product.create({
    storeId,
    name,
    price: overrides.price ?? 50000,
    salePrice: overrides.salePrice ?? undefined,
    categoryId: (overrides.categoryId ?? null) as any,
  });
  return overrides.createdAt ? Product.from({ ...p.toJSON(), createdAt: overrides.createdAt }) : p;
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

describe("ListProducts filters + sort (collections)", () => {
  let repo: ProductRepository;
  let useCase: ListProducts;

  beforeEach(() => {
    repo = mockRepo();
    useCase = new ListProducts(repo);
  });

  it("filters by category", async () => {
    const a = makeProduct("A", { categoryId: catA as any });
    const b = makeProduct("B", { categoryId: catB as any });
    (repo.findByStoreId as any).mockResolvedValue([a, b]);

    const result = await useCase.execute({ storeId, categoryId: catA });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.map((p) => p.name)).toEqual(["A"]);
  });

  it("sorts by price ascending using the effective (sale) price", async () => {
    const a = makeProduct("A", { price: 100000 });
    const b = makeProduct("B", { price: 50000, salePrice: 30000 }); // effective 30000
    const c = makeProduct("C", { price: 40000 });
    (repo.findByStoreId as any).mockResolvedValue([a, b, c]);

    const result = await useCase.execute({ storeId, sort: "price_asc" });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.map((p) => p.name)).toEqual(["B", "C", "A"]);
  });

  it("sorts by price descending", async () => {
    const a = makeProduct("A", { price: 10000 });
    const b = makeProduct("B", { price: 90000 });
    (repo.findByStoreId as any).mockResolvedValue([a, b]);

    const result = await useCase.execute({ storeId, sort: "price_desc" });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.map((p) => p.name)).toEqual(["B", "A"]);
  });

  it("sorts by newest first (createdAt desc)", async () => {
    const a = makeProduct("A", { createdAt: "2026-01-01T00:00:00.000Z" });
    const b = makeProduct("B", { createdAt: "2026-03-01T00:00:00.000Z" });
    const c = makeProduct("C", { createdAt: "2026-02-01T00:00:00.000Z" });
    (repo.findByStoreId as any).mockResolvedValue([a, b, c]);

    const result = await useCase.execute({ storeId, sort: "newest" });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.map((p) => p.name)).toEqual(["B", "C", "A"]);
  });

  it("sorts by name ascending", async () => {
    const a = makeProduct("Bakso");
    const b = makeProduct("Ayam");
    (repo.findByStoreId as any).mockResolvedValue([a, b]);

    const result = await useCase.execute({ storeId, sort: "name_asc" });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.map((p) => p.name)).toEqual(["Ayam", "Bakso"]);
  });

  it("default sort keeps store order", async () => {
    const a = makeProduct("Z", { price: 90000 });
    const b = makeProduct("A", { price: 1000 });
    (repo.findByStoreId as any).mockResolvedValue([a, b]);

    const result = await useCase.execute({ storeId });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.map((p) => p.name)).toEqual(["Z", "A"]);
  });
});
