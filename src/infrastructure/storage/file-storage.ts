/**
 * FileStorage interface — abstracts file storage (R2, S3, etc.).
 */

export interface FileStorage {
  put(key: string, body: ArrayBuffer | Uint8Array | ReadableStream, options?: {
    contentType?: string;
  }): Promise<void>;
  getUrl(key: string): string;
}
