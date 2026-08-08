/**
 * Product entity — belongs to Store aggregate.
 */

import type { EntityId, ProductType as ProductTypeT } from "../shared/types";
import { createEntityId, ProductType } from "../shared/types";
import { isValidPrice, isValidProductType, isValidSlug, isValidStock, isValidWeight } from "./rules";

export interface ProductProps {
  id: EntityId;
  storeId: EntityId;
  name: string;
  description: string | null;
  price: number; // Rupiah
  imageUrl: string | null; // legacy single image — cover fallback
  images: string[]; // gallery (R2 keys or URLs)
  salePrice: number | null; // discounted price; null = no sale
  slug: string | null; // URL slug, unique per store; null = fall back to id
  categoryId: EntityId | null;
  stock: number | null; // available units; null = unlimited, 0 = sold out
  weight: number | null; // grams — used for Biteship shipping rates
  isAvailable: boolean;
  type: ProductTypeT;
  createdAt: string; // ISO — used for "newest" sorting
}

export class Product {
  private constructor(private readonly props: ProductProps) {}

  static create(params: {
    storeId: EntityId;
    name: string;
    description?: string;
    price: number;
    imageUrl?: string;
    images?: string[];
    salePrice?: number | null;
    slug?: string | null;
    categoryId?: EntityId | null;
    stock?: number | null;
    weight?: number | null;
    type?: ProductTypeT;
  }): Product {
    if (!params.name.trim()) throw new Error("Product name is required");
    if (!isValidPrice(params.price)) throw new Error("Price must be >= 0");
    if (params.salePrice !== undefined && params.salePrice !== null && !isValidPrice(params.salePrice)) {
      throw new Error("Sale price must be >= 0");
    }
    if (params.slug !== undefined && params.slug !== null && !isValidSlug(params.slug)) {
      throw new Error("Invalid slug");
    }
    if (params.stock !== undefined && params.stock !== null && !isValidStock(params.stock)) {
      throw new Error("Stock must be >= 0");
    }
    if (params.weight !== undefined && params.weight !== null && !isValidWeight(params.weight)) {
      throw new Error("Weight must be >= 1 gram");
    }

    const type = params.type ?? ProductType.Product;
    if (!isValidProductType(type)) throw new Error("Invalid product type");

    return new Product({
      id: createEntityId(),
      storeId: params.storeId,
      name: params.name.trim(),
      description: params.description ?? null,
      price: params.price,
      imageUrl: params.imageUrl ?? null,
      images: params.images ?? [],
      salePrice: params.salePrice ?? null,
      slug: params.slug ?? null,
      categoryId: params.categoryId ?? null,
      stock: params.stock ?? null,
      weight: params.weight ?? null,
      isAvailable: true,
      type,
      createdAt: new Date().toISOString(),
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
  get images() { return this.props.images; }
  get salePrice() { return this.props.salePrice; }
  get slug() { return this.props.slug; }
  get categoryId() { return this.props.categoryId; }
  get stock() { return this.props.stock; }
  get weight() { return this.props.weight; }
  /** true when stock is tracked and exhausted (0 or negative). */
  get isOutOfStock(): boolean {
    return this.props.stock !== null && this.props.stock <= 0;
  }
  get isAvailable() { return this.props.isAvailable; }
  get type() { return this.props.type; }
  get createdAt() { return this.props.createdAt; }

  /** Price a buyer actually pays (sale wins over base). */
  get effectivePrice(): number {
    return this.props.salePrice ?? this.props.price;
  }

  /** First gallery image, falling back to the legacy single image. */
  get coverImage(): string | null {
    return this.props.images[0] ?? this.props.imageUrl ?? null;
  }

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
    images?: string[];
    salePrice?: number | null;
    slug?: string | null;
    categoryId?: EntityId | null;
    stock?: number | null;
    weight?: number | null;
    type?: ProductTypeT;
  }): Product {
    if (params.name !== undefined) this.props.name = params.name;
    if (params.description !== undefined) this.props.description = params.description;
    if (params.imageUrl !== undefined) this.props.imageUrl = params.imageUrl;
    if (params.images !== undefined) this.props.images = params.images;
    if (params.salePrice !== undefined) {
      if (params.salePrice !== null && !isValidPrice(params.salePrice)) throw new Error("Sale price must be >= 0");
      this.props.salePrice = params.salePrice;
    }
    if (params.slug !== undefined) {
      if (params.slug !== null && !isValidSlug(params.slug)) throw new Error("Invalid slug");
      this.props.slug = params.slug;
    }
    if (params.categoryId !== undefined) this.props.categoryId = params.categoryId;
    if (params.stock !== undefined) {
      if (params.stock !== null && !isValidStock(params.stock)) throw new Error("Stock must be >= 0");
      this.props.stock = params.stock;
    }
    if (params.weight !== undefined) {
      if (params.weight !== null && !isValidWeight(params.weight)) throw new Error("Weight must be >= 1 gram");
      this.props.weight = params.weight;
    }
    if (params.type !== undefined) {
      if (!isValidProductType(params.type)) throw new Error("Invalid product type");
      this.props.type = params.type;
    }
    return this;
  }

  /**
   * Reserve `quantity` units of stock (order submit). No-op for unlimited
   * (null) stock. Throws when insufficient — callers check isOutOfStock
   * / stock first for a clean error.
   */
  reserveStock(quantity: number): Product {
    if (this.props.stock === null) return this;
    if (quantity < 1) throw new Error("Quantity must be >= 1");
    if (this.props.stock < quantity) throw new Error("Insufficient stock");
    this.props.stock -= quantity;
    return this;
  }

  toJSON(): ProductProps {
    return { ...this.props };
  }
}
