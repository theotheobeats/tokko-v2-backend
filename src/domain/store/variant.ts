/**
 * ProductVariant entity — a purchasable option of a Product
 * (e.g. "Size M", "Warna Biru"). Belongs to the Product aggregate and is
 * replaced on product save.
 *
 * price: null means the variant inherits the product's effective price.
 */

import type { EntityId } from "../shared/types";
import { createEntityId } from "../shared/types";
import { isValidPrice } from "./rules";

export interface ProductVariantProps {
  id: EntityId;
  productId: EntityId;
  name: string;
  price: number | null;
  sortOrder: number;
}

export class ProductVariant {
  private constructor(private readonly props: ProductVariantProps) {}

  static create(params: {
    productId: EntityId;
    name: string;
    price?: number | null;
    sortOrder?: number;
  }): ProductVariant {
    if (!params.name.trim()) throw new Error("Variant name is required");
    if (params.price !== undefined && params.price !== null && !isValidPrice(params.price)) {
      throw new Error("Variant price must be >= 0");
    }
    return new ProductVariant({
      id: createEntityId(),
      productId: params.productId,
      name: params.name.trim(),
      price: params.price ?? null,
      sortOrder: params.sortOrder ?? 0,
    });
  }

  static from(props: ProductVariantProps): ProductVariant {
    return new ProductVariant({ ...props });
  }

  get id() { return this.props.id; }
  get productId() { return this.props.productId; }
  get name() { return this.props.name; }
  get price() { return this.props.price; }
  get sortOrder() { return this.props.sortOrder; }

  toJSON(): ProductVariantProps {
    return { ...this.props };
  }
}
