/**
 * GenerateProductDescription use case.
 */

import type { Result } from "../../domain/shared/types";
import { ok, err } from "../../domain/shared/types";

export interface GenerateProductDescriptionInput {
  name: string;
  category: string;
}

export interface GenerateProductDescriptionOutput {
  description: string;
}

export interface GenerateProductDescriptionError {
  code: "AI_GENERATION_FAILED";
  message: string;
}

export class GenerateProductDescription {
  constructor(
    private readonly aiGenerate: (input: { name: string; category: string }) => Promise<string>,
  ) {}

  async execute(input: GenerateProductDescriptionInput): Promise<Result<GenerateProductDescriptionOutput, GenerateProductDescriptionError>> {
    try {
      const description = (await this.aiGenerate({
        name: input.name,
        category: input.category,
      })).trim();

      return ok({ description });
    } catch (error: any) {
      return err({
        code: "AI_GENERATION_FAILED",
        message: error?.message ?? "Gagal membuat deskripsi produk.",
      });
    }
  }
}
