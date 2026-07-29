import { describe, it, expect, vi } from "vitest";
import { UploadImage } from "../../../src/application/upload/upload-image";
import type { FileStorage } from "../../../src/infrastructure/storage/file-storage";
import { createEntityId } from "../../../src/domain/shared/types";

const storeId = createEntityId();

function mockStorage(overrides?: Partial<FileStorage>): FileStorage {
  return {
    put: vi.fn().mockResolvedValue(undefined),
    getUrl: vi.fn().mockImplementation((key: string) => `https://cdn.tokko.com/${key}`),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// UploadImage
// ---------------------------------------------------------------------------

describe("UploadImage use case", () => {
  it("should upload a valid JPG image", async () => {
    const storage = mockStorage();
    const useCase = new UploadImage(storage);
    const file = new File(["dummy"], "product.jpg", { type: "image/jpeg" });

    const result = await useCase.execute({
      storeId,
      file,
      purpose: "product",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.key).toContain(`stores/${storeId}/`);
      expect(result.value.key).toContain(".jpg");
      expect(result.value.url).toContain("cdn.tokko.com");
    }
    expect(storage.put).toHaveBeenCalledOnce();
  });

  it("should upload a valid PNG image", async () => {
    const storage = mockStorage();
    const useCase = new UploadImage(storage);
    const file = new File(["dummy"], "hero.png", { type: "image/png" });

    const result = await useCase.execute({
      storeId,
      file,
      purpose: "hero",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.key).toContain(".png");
    }
  });

  it("should reject unsupported file types", async () => {
    const storage = mockStorage();
    const useCase = new UploadImage(storage);
    const file = new File(["dummy"], "doc.pdf", { type: "application/pdf" });

    const result = await useCase.execute({
      storeId,
      file,
      purpose: "product",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INVALID_FILE_TYPE");
    }
    expect(storage.put).not.toHaveBeenCalled();
  });

  it("should reject files over 2MB", async () => {
    const storage = mockStorage();
    const useCase = new UploadImage(storage);
    // Simulate a file > 2MB
    const largeBuffer = new Uint8Array(3 * 1024 * 1024); // 3MB
    const file = new File([largeBuffer], "big.jpg", { type: "image/jpeg" });

    // Override size since File constructor doesn't set it
    Object.defineProperty(file, "size", { value: 3 * 1024 * 1024 });

    const result = await useCase.execute({
      storeId,
      file,
      purpose: "product",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("FILE_TOO_LARGE");
    }
    expect(storage.put).not.toHaveBeenCalled();
  });

  it("should reject files with no extension", async () => {
    const storage = mockStorage();
    const useCase = new UploadImage(storage);
    const file = new File(["dummy"], "noextension", { type: "image/jpeg" });

    const result = await useCase.execute({
      storeId,
      file,
      purpose: "product",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INVALID_FILE_TYPE");
    }
  });

  it("should generate unique keys with UUIDs", async () => {
    const storage = mockStorage();
    const useCase = new UploadImage(storage);
    
    const file1 = new File(["a"], "photo.jpg", { type: "image/jpeg" });
    const file2 = new File(["b"], "photo.jpg", { type: "image/jpeg" });

    const res1 = await useCase.execute({ storeId, file: file1, purpose: "product" });
    const res2 = await useCase.execute({ storeId, file: file2, purpose: "product" });

    expect(res1.ok).toBe(true);
    expect(res2.ok).toBe(true);
    if (res1.ok && res2.ok) {
      expect(res1.value.key).not.toBe(res2.value.key);
    }
  });
});
