/**
 * UpdateProduct use case.
 */

import type { EntityId, ProductType as ProductTypeT } from "../../domain/shared/types";
import type { Result } from "../../domain/shared/types";
import { ok, err } from "../../domain/shared/types";
import { Product } from "../../domain/store/product";
import { isValidProductType } from "../../domain/shared/types";
import type { ProductRepository } from "../../infrastructure/repos/d1-product-repo";

export interface UpdateProductInput {
  productId: EntityId;
  name?: string;
  price?: number;
  description?: string | null;
  imageUrl?: string | null;
  isAvailable?: boolean;
  type?: ProductTypeT;
}

export interface UpdateProductError {
  code: "NOT_FOUND" | "VALIDATION";
  message: string;
  field?: string;
}

export class UpdateProduct {
  constructor(private readonly productRepo: ProductRepository) {}

  async execute(input: UpdateProductInput): Promise<Result<ReturnType<Product["toJSON"]>, UpdateProductError>> {
    const product = await this.productRepo.findById(input.productId);
    if (!product) {
      return err({ code: "NOT_FOUND", message: "Produk tidak ditemukan." });
    }

    // Validate price if provided
    if (input.price !== undefined) {
      if (input.price < 0 || !Number.isInteger(input.price)) {
        return err({ code: "VALIDATION", message: "Harga harus >= 0.", field: "price" });
      }
      product.updatePrice(input.price);
    }

    // Validate type if provided
    if (input.type !== undefined && !isValidProductType(input.type)) {
      return err({ code: "VALIDATION", message: "Tipe produk tidak valid.", field: "type" });
    }

    // Update details
    if (input.name !== undefined || input.description !== undefined || input.imageUrl !== undefined || input.type !== undefined) {
      product.updateDetails({
        name: input.name,
        description: input.description,
        imageUrl: input.imageUrl,
        type: input.type,
      });
    }

    // Toggle availability
    if (input.isAvailable !== undefined && input.isAvailable !== product.isAvailable) {
      product.toggleAvailability();
    }

    await this.productRepo.save(product);
    return ok(product.toJSON());
  }
}
