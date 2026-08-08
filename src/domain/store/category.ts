/**
 * ProductCategory entity — a soft grouping for a store's products
 * (e.g. "Blanket & Sleeping Buddy"). Belongs to the Store aggregate.
 */

import type { EntityId } from "../shared/types";
import { createEntityId } from "../shared/types";
import { isValidSlug, slugify } from "./rules";

export interface ProductCategoryProps {
  id: EntityId;
  storeId: EntityId;
  name: string;
  slug: string;
}

export class ProductCategory {
  private constructor(private readonly props: ProductCategoryProps) {}

  static create(params: { storeId: EntityId; name: string; slug?: string }): ProductCategory {
    if (!params.name.trim()) throw new Error("Category name is required");
    const slug = params.slug ?? slugify(params.name);
    if (!isValidSlug(slug)) throw new Error("Invalid category slug");
    return new ProductCategory({
      id: createEntityId(),
      storeId: params.storeId,
      name: params.name.trim(),
      slug,
    });
  }

  static from(props: ProductCategoryProps): ProductCategory {
    return new ProductCategory({ ...props });
  }

  get id() { return this.props.id; }
  get storeId() { return this.props.storeId; }
  get name() { return this.props.name; }
  get slug() { return this.props.slug; }

  rename(name: string): ProductCategory {
    if (!name.trim()) throw new Error("Category name is required");
    this.props.name = name.trim();
    return this;
  }

  toJSON(): ProductCategoryProps {
    return { ...this.props };
  }
}
