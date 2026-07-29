import { describe, it, expect, vi } from "vitest";
import { PublishStore } from "../../../src/application/store/publish-store";
import { UnpublishStore } from "../../../src/application/store/unpublish-store";
import type { StoreRepository } from "../../../src/application/store/store-repo";
import { Store } from "../../../src/domain/store/store";
import { createEntityId } from "../../../src/domain/shared/types";
import { StoreStatus, BusinessType, Aesthetic } from "../../../src/domain/store/types";

function mockStoreRepo(overrides?: Partial<StoreRepository>): StoreRepository {
  return {
    findById: vi.fn().mockResolvedValue(null),
    findBySubdomain: vi.fn().mockResolvedValue(null),
    findByOwnerId: vi.fn().mockResolvedValue(null),
    save: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    countProducts: vi.fn().mockResolvedValue(0),
    ...overrides,
  };
}

const ownerId = createEntityId();

function makeStore(productCount = 0) {
  const store = Store.create({
    ownerId,
    name: "Test Store",
    businessType: BusinessType.Food,
    aestheticPreference: Aesthetic.Warm,
    whatsappNumber: "+62",
  });
  store.setProductCount(productCount);
  return store;
}

describe("PublishStore use case", () => {
  it("should publish when store has products", async () => {
    const store = makeStore(5);
    const repo = mockStoreRepo({
      findById: vi.fn().mockResolvedValue(store),
      countProducts: vi.fn().mockResolvedValue(5),
    });
    const useCase = new PublishStore(repo);

    const result = await useCase.execute({ storeId: store.id });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe(StoreStatus.Published);
    }
    expect(repo.save).toHaveBeenCalledOnce();
  });

  it("should reject when store has no products", async () => {
    const store = makeStore(0);
    const repo = mockStoreRepo({ findById: vi.fn().mockResolvedValue(store) });
    const useCase = new PublishStore(repo);

    const result = await useCase.execute({ storeId: store.id });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("STORE_HAS_NO_PRODUCTS");
    expect(repo.save).not.toHaveBeenCalled();
  });

  it("should return error when store not found", async () => {
    const repo = mockStoreRepo();
    const useCase = new PublishStore(repo);

    const result = await useCase.execute({ storeId: createEntityId() });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NOT_FOUND");
  });

  it("should not re-publish an already published store", async () => {
    const store = makeStore(5);
    store.publish(); // Already published
    const repo = mockStoreRepo({
      findById: vi.fn().mockResolvedValue(store),
      countProducts: vi.fn().mockResolvedValue(5),
    });
    const useCase = new PublishStore(repo);

    const result = await useCase.execute({ storeId: store.id });

    // Should succeed — idempotent
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.status).toBe(StoreStatus.Published);
  });
});

describe("UnpublishStore use case", () => {
  it("should unpublish a published store", async () => {
    const store = makeStore(5);
    store.publish();
    const repo = mockStoreRepo({ findById: vi.fn().mockResolvedValue(store) });
    const useCase = new UnpublishStore(repo);

    const result = await useCase.execute({ storeId: store.id });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe(StoreStatus.Draft);
    }
    expect(repo.save).toHaveBeenCalledOnce();
  });

  it("should return error when store not found", async () => {
    const repo = mockStoreRepo();
    const useCase = new UnpublishStore(repo);

    const result = await useCase.execute({ storeId: createEntityId() });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NOT_FOUND");
  });
});
