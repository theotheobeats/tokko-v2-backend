import { describe, it, expect, vi, beforeEach } from "vitest";
import { UpdateProduct } from "../../../src/application/product/update-product";
import { ListProducts } from "../../../src/application/product/list-products";
import { DeleteProduct } from "../../../src/application/product/delete-product";
import type { ProductRepository } from "../../../src/infrastructure/repos/d1-product-repo";
import { Product } from "../../../src/domain/store/product";
import { createEntityId } from "../../../src/domain/shared/types";

function makeProduct(overrides?: Partial<{ name: string; price: number; isAvailable: boolean }>) {
  return Product.create({
    storeId: createEntityId(),
    name: overrides?.name ?? "Test Product",
    price: overrides?.price ?? 50000,
  });
}

function mockRepo(overrides?: Partial<ProductRepository>): ProductRepository {
  return {
    findById: vi.fn().mockResolvedValue(null),
    findByStoreId: vi.fn().mockResolvedValue([]),
    save: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    countByStoreId: vi.fn().mockResolvedValue(0),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// UpdateProduct
// ---------------------------------------------------------------------------

describe("UpdateProduct use case", () => {
  let repo: ProductRepository;
  let useCase: UpdateProduct;

  beforeEach(() => {
    repo = mockRepo();
    useCase = new UpdateProduct(repo);
  });

  it("should update product name", async () => {
    const product = makeProduct();
    (repo.findById as any).mockResolvedValue(product);

    const result = await useCase.execute({
      productId: product.id,
      name: "New Name",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.name).toBe("New Name");
    }
    expect(repo.save).toHaveBeenCalledOnce();
  });

  it("should update product price", async () => {
    const product = makeProduct();
    (repo.findById as any).mockResolvedValue(product);

    const result = await useCase.execute({
      productId: product.id,
      price: 99999,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.price).toBe(99999);
    }
  });

  it("should toggle availability", async () => {
    const product = makeProduct();
    (repo.findById as any).mockResolvedValue(product);
    expect(product.isAvailable).toBe(true);

    const result = await useCase.execute({
      productId: product.id,
      isAvailable: false,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.isAvailable).toBe(false);
    }
  });

  it("should return error when product not found", async () => {
    const result = await useCase.execute({
      productId: createEntityId(),
      name: "Ghost",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("NOT_FOUND");
    }
  });

  it("should reject negative price", async () => {
    const product = makeProduct();
    (repo.findById as any).mockResolvedValue(product);

    const result = await useCase.execute({
      productId: product.id,
      price: -1,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VALIDATION");
    }
    expect(repo.save).not.toHaveBeenCalled();
  });

  it("should update product type", async () => {
    const product = makeProduct();
    (repo.findById as any).mockResolvedValue(product);

    const result = await useCase.execute({
      productId: product.id,
      type: "booking",
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.type).toBe("booking");
    expect(repo.save).toHaveBeenCalledOnce();
  });

  it("should reject invalid product type on update", async () => {
    const product = makeProduct();
    (repo.findById as any).mockResolvedValue(product);

    const result = await useCase.execute({
      productId: product.id,
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

// ---------------------------------------------------------------------------
// ListProducts
// ---------------------------------------------------------------------------

describe("ListProducts use case", () => {
  let repo: ProductRepository;
  let useCase: ListProducts;

  beforeEach(() => {
    repo = mockRepo();
    useCase = new ListProducts(repo);
  });

  it("should return empty list for store with no products", async () => {
    const result = await useCase.execute({ storeId: createEntityId() });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(0);
    }
  });

  it("should return all products for a store", async () => {
    const p1 = makeProduct({ name: "A" }).toJSON();
    const p2 = makeProduct({ name: "B" }).toJSON();
    const p3 = makeProduct({ name: "C" }).toJSON();

    const listRepo = mockRepo({
      findByStoreId: vi.fn().mockResolvedValue([
        Product.from(p1),
        Product.from(p2),
        Product.from(p3),
      ]),
    });
    const uc = new ListProducts(listRepo);

    const result = await uc.execute({ storeId: createEntityId() });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(3);
      expect(result.value[0].name).toBe("A");
    }
  });
});

// ---------------------------------------------------------------------------
// DeleteProduct
// ---------------------------------------------------------------------------

describe("DeleteProduct use case", () => {
  let repo: ProductRepository;
  let useCase: DeleteProduct;

  beforeEach(() => {
    repo = mockRepo();
    useCase = new DeleteProduct(repo);
  });

  it("should delete an existing product", async () => {
    const product = makeProduct();
    (repo.findById as any).mockResolvedValue(product);

    const result = await useCase.execute({ productId: product.id });

    expect(result.ok).toBe(true);
    expect(repo.delete).toHaveBeenCalledWith(product.id);
  });

  it("should return error when product not found", async () => {
    const result = await useCase.execute({ productId: createEntityId() });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("NOT_FOUND");
    }
    expect(repo.delete).not.toHaveBeenCalled();
  });
});
