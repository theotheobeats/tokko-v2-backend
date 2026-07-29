/**
 * Product entity — belongs to Store aggregate.
 */

import type { EntityId } from "../shared/types";
import { createEntityId } from "../shared/types";
import { isValidPrice } from "./rules";

export interface ProductProps {
  id: EntityId;
  storeId: EntityId;
  name: string;
  description: string | null;
  price: number; // Rupiah
  imageUrl: string | null;
  isAvailable: boolean;
}

export class Product {
  private constructor(private readonly props: ProductProps) {}

  static create(params: {
    storeId: EntityId;
    name: string;
    description?: string;
    price: number;
    imageUrl?: string;
  }): Product {
    if (!params.name.trim()) throw new Error("Product name is required");
    if (!isValidPrice(params.price)) throw new Error("Price must be >= 0");

    return new Product({
      id: createEntityId(),
      storeId: params.storeId,
      name: params.name.trim(),
      description: params.description ?? null,
      price: params.price,
      imageUrl: params.imageUrl ?? null,
      isAvailable: true,
    });
  }

  static from(props: ProductProps): Product {
    return new Product({ ...props });
  }

  get id() { return this.props.id; }
  get storeId() { return this.props.storeId; }
  get name() { return this.props.name; }
  get description() { return this.props.description; }
  get price() { return this.props.price; }
  get imageUrl() { return this.props.imageUrl; }
  get isAvailable() { return this.props.isAvailable; }

  updatePrice(newPrice: number): Product {
    if (!isValidPrice(newPrice)) throw new Error("Price must be >= 0");
    this.props.price = newPrice;
    return this;
  }

  toggleAvailability(): Product {
    this.props.isAvailable = !this.props.isAvailable;
    return this;
  }

  updateDetails(params: {
    name?: string;
    description?: string | null;
    imageUrl?: string | null;
  }): Product {
    if (params.name !== undefined) this.props.name = params.name;
    if (params.description !== undefined) this.props.description = params.description;
    if (params.imageUrl !== undefined) this.props.imageUrl = params.imageUrl;
    return this;
  }

  toJSON(): ProductProps {
    return { ...this.props };
  }
}
