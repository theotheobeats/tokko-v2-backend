import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  ListRelatedProducts,
  RELATED_PRODUCTS_LIMIT,
} from "../../../src/application/product/list-related-products";
import type { ProductRepository } from "../../../src/infrastructure/repos/d1-product-repo";
import { Product } from "../../../src/domain/store/product";
import { createEntityId } from "../../../src/domain/shared/types";

function makeProduct(name: string) {
  return Product.create({
    storeId: createEntityId(),
    name,
    price: 50000,
  });
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
    countByStoreId: vi.fn().mockResolvedValue(0),
    ...overrides,
  };
}

describe("ListRelatedProducts use case", () => {
  let repo: ProductRepository;
  let useCase: ListRelatedProducts;
  const storeId = createEntityId();

  beforeEach(() => {
    repo = mockRepo();
    useCase = new ListRelatedProducts(repo);
  });

  it("returns other available products in the same store", async () => {
    const a = makeProduct("A");
    const b = makeProduct("B");
    const c = makeProduct("C");
    (repo.findByStoreId as any).mockResolvedValue([a, b, c]);
    (repo.findById as any).mockResolvedValue(a); // the "current" product

    const result = await useCase.execute({ storeId, productId: a.id });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.map((p) => p.name)).toEqual(["B", "C"]);
    }
  });

  it("excludes the product itself", async () => {
    const a = makeProduct("A");
    (repo.findByStoreId as any).mockResolvedValue([a]);
    (repo.findById as any).mockResolvedValue(a);

    const result = await useCase.execute({ storeId, productId: a.id });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(0);
    }
  });

  it("excludes unavailable products", async () => {
    const a = makeProduct("A");
    const b = makeProduct("B");
    b.toggleAvailability(); // now unavailable
    (repo.findByStoreId as any).mockResolvedValue([a, b]);
    (repo.findById as any).mockResolvedValue(a);

    const result = await useCase.execute({ storeId, productId: a.id });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(0);
    }
  });

  it(`caps results at ${RELATED_PRODUCTS_LIMIT}`, async () => {
    const a = makeProduct("A");
    const others = Array.from({ length: RELATED_PRODUCTS_LIMIT + 3 }, (_, i) => makeProduct(`P${i}`));
    (repo.findByStoreId as any).mockResolvedValue([a, ...others]);
    (repo.findById as any).mockResolvedValue(a);

    const result = await useCase.execute({ storeId, productId: a.id });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(RELATED_PRODUCTS_LIMIT);
    }
  });
});
