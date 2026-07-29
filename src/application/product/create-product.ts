/**
 * CreateProduct use case.
 */

import type { EntityId } from "../../domain/shared/types";
import type { Result } from "../../domain/shared/types";
import { ok, err } from "../../domain/shared/types";
import { Product } from "../../domain/store/product";
import type { ProductRepository } from "../../infrastructure/repos/d1-product-repo";

export interface CreateProductInput {
  storeId: EntityId;
  name: string;
  price: number;
  description?: string;
  imageUrl?: string;
}

export interface CreateProductError {
  code: "VALIDATION" | "PRODUCT_LIMIT_REACHED";
  message: string;
  field?: string;
}

export class CreateProduct {
  constructor(private readonly productRepo: ProductRepository) {}

  async execute(input: CreateProductInput): Promise<Result<ReturnType<Product["toJSON"]>, CreateProductError>> {
    // Validate
    if (!input.name.trim()) {
      return err({ code: "VALIDATION", message: "Nama produk wajib diisi.", field: "name" });
    }
    if (input.price < 0 || !Number.isInteger(input.price)) {
      return err({ code: "VALIDATION", message: "Harga harus >= 0.", field: "price" });
    }

    // Check limit
    const count = await this.productRepo.countByStoreId(input.storeId);
    if (count >= 20) {
      return err({ code: "PRODUCT_LIMIT_REACHED", message: "Maksimal 20 produk per toko." });
    }

    // Create
    const product = Product.create({
      storeId: input.storeId,
      name: input.name,
      price: input.price,
      description: input.description,
      imageUrl: input.imageUrl,
    });

    await this.productRepo.save(product);
    return ok(product.toJSON());
  }
}
