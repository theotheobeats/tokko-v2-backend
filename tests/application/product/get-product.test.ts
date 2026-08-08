import { describe, it, expect, vi, beforeEach } from "vitest";
import { GetProduct } from "../../../src/application/product/get-product";
import type { ProductRepository } from "../../../src/infrastructure/repos/d1-product-repo";
import { Product } from "../../../src/domain/store/product";
import { createEntityId } from "../../../src/domain/shared/types";

function makeProduct(name = "Test Product", price = 50000) {
  return Product.create({
    storeId: createEntityId(),
    name,
    price,
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

describe("GetProduct use case", () => {
  let repo: ProductRepository;
  let useCase: GetProduct;

  beforeEach(() => {
    repo = mockRepo();
    useCase = new GetProduct(repo);
  });

  it("returns the product when found", async () => {
    const product = makeProduct();
    (repo.findById as any).mockResolvedValue(product);

    const result = await useCase.execute({ productId: product.id });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).toBe(product.id);
      expect(result.value.name).toBe("Test Product");
    }
  });

  it("returns NOT_FOUND when the product does not exist", async () => {
    const result = await useCase.execute({ productId: createEntityId() });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("NOT_FOUND");
    }
  });
});
