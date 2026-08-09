/**
 * UploadImage use case.
 */

import type { EntityId } from "../../domain/shared/types";
import type { Result } from "../../domain/shared/types";
import { ok, err } from "../../domain/shared/types";
import type { FileStorage } from "../../infrastructure/storage/file-storage";

// ---------------------------------------------------------------------------
// Input/Output
// ---------------------------------------------------------------------------

export interface UploadImageInput {
  storeId: EntityId;
  file: File;
  purpose: "product" | "hero" | "logo";
}

export interface UploadImageOutput {
  key: string;
  url: string;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export interface UploadImageError {
  code: "FILE_TOO_LARGE" | "INVALID_FILE_TYPE";
  message: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const ALLOWED_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"];

// ---------------------------------------------------------------------------
// Use Case
// ---------------------------------------------------------------------------

export class UploadImage {
  constructor(private readonly storage: FileStorage) {}

  async execute(input: UploadImageInput): Promise<Result<UploadImageOutput, UploadImageError>> {
    // Validate file size
    if (input.file.size > MAX_FILE_SIZE) {
      return err({ code: "FILE_TOO_LARGE", message: "Ukuran file maksimal 2MB." });
    }

    // Validate MIME type
    if (!ALLOWED_TYPES.includes(input.file.type)) {
      return err({ code: "INVALID_FILE_TYPE", message: "Hanya file JPG, PNG, dan WebP yang diizinkan." });
    }

    // Validate file extension
    const ext = this._getExtension(input.file.name);
    if (!ext || !ALLOWED_EXTENSIONS.includes(ext)) {
      return err({ code: "INVALID_FILE_TYPE", message: "Ekstensi file tidak didukung." });
    }

    // Generate storage key
    const key = `stores/${input.storeId}/${crypto.randomUUID()}${ext}`;

    // Upload to storage
    const buffer = await input.file.arrayBuffer();
    await this.storage.put(key, buffer, {
      contentType: input.file.type,
    });

    const url = this.storage.getUrl(key);

    return ok({ key, url });
  }

  private _getExtension(filename: string): string | null {
    const lastDot = filename.lastIndexOf(".");
    if (lastDot === -1) return null;
    return filename.substring(lastDot).toLowerCase();
  }
}
