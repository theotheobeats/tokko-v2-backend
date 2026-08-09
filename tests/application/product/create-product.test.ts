import { describe, it, expect, vi, beforeEach } from "vitest";
import { CreateProduct } from "../../../src/application/product/create-product";
import type { ProductRepository } from "../../../src/infrastructure/repos/d1-product-repo";
import { createEntityId, type EntityId } from "../../../src/domain/shared/types";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

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

const storeId = createEntityId();

// ---------------------------------------------------------------------------
// CreateProduct
// ---------------------------------------------------------------------------

describe("CreateProduct use case", () => {
  let repo: ProductRepository;

/** Physical products now require weight + dimensions (shipping). */
const SHIPPABLE = { weight: 500, width: 10, length: 10, height: 5 };
  let useCase: CreateProduct;

  beforeEach(() => {
    repo = mockRepo();
    useCase = new CreateProduct(repo);
  });

  // HAPPY PATH
  it("should create a product", async () => {
    const result = await useCase.execute({
      storeId,
      name: "Rainbow Cake",
      price: 85000,
      ...SHIPPABLE,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.name).toBe("Rainbow Cake");
      expect(result.value.price).toBe(85000);
      expect(result.value.isAvailable).toBe(true);
      expect(result.value.storeId).toBe(storeId);
    }
    expect(repo.save).toHaveBeenCalledOnce();
  });

  // VALIDATION
  it("should reject empty name", async () => {
    const result = await useCase.execute({
      storeId,
      name: "",
      price: 85000,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VALIDATION");
    }
    expect(repo.save).not.toHaveBeenCalled();
  });

  it("should reject whitespace-only name", async () => {
    const result = await useCase.execute({
      storeId,
      name: "   ",
      price: 85000,
    });

    expect(result.ok).toBe(false);
  });

  it("should reject negative price", async () => {
    const result = await useCase.execute({
      storeId,
      name: "Cake",
      price: -1000,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VALIDATION");
    }
  });

  it("should accept price 0 (free item)", async () => {
    const result = await useCase.execute({
      storeId,
      name: "Free Sample",
      price: 0,
      ...SHIPPABLE,
    });

    expect(result.ok).toBe(true);
  });

  it("should create with optional description and image", async () => {
    const result = await useCase.execute({
      storeId,
      name: "Cake",
      price: 50000,
      description: "Delicious cake",
      imageUrl: "images/cake.jpg",
      ...SHIPPABLE,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.description).toBe("Delicious cake");
      expect(result.value.imageUrl).toBe("images/cake.jpg");
    }
  });

  // PRODUCT LIMIT
  it("should reject when store has max 20 products", async () => {
    const fullRepo = mockRepo({ countByStoreId: vi.fn().mockResolvedValue(20) });
    const uc = new CreateProduct(fullRepo);

    const result = await uc.execute({
      storeId,
      name: "Cake",
      price: 50000,
      ...SHIPPABLE,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("PRODUCT_LIMIT_REACHED");
    }
  });

  it("should allow product when store has 19 products", async () => {
    const nearFullRepo = mockRepo({ countByStoreId: vi.fn().mockResolvedValue(19) });
    const uc = new CreateProduct(nearFullRepo);

    const result = await uc.execute({
      storeId,
      name: "Cake",
      price: 50000,
      ...SHIPPABLE,
    });

    expect(result.ok).toBe(true);
  });

  // PRODUCT TYPE
  it("should default to product type", async () => {
    const result = await useCase.execute({
      storeId,
      name: "Cake",
      price: 50000,
      ...SHIPPABLE,
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.type).toBe("product");
  });

  it("should create a service type product", async () => {
    const result = await useCase.execute({
      storeId,
      name: "Potong Rambut",
      price: 50000,
      type: "service",
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.type).toBe("service");
  });

  it("should create a booking type product", async () => {
    const result = await useCase.execute({
      storeId,
      name: "Konsultasi",
      price: 0,
      type: "booking",
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.type).toBe("booking");
  });

  it("should reject invalid product type", async () => {
    const result = await useCase.execute({
      storeId,
      name: "Cake",
      price: 50000,
      type: "digital" as never,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VALIDATION");
      expect(result.error.field).toBe("type");
    }
    expect(repo.save).not.toHaveBeenCalled();
  });
});
