import { describe, it, expect } from "vitest";
import { Product } from "../../../src/domain/store/product";
import { ProductVariant } from "../../../src/domain/store/variant";
import { ProductCategory } from "../../../src/domain/store/category";
import { createEntityId } from "../../../src/domain/shared/types";

const storeId = createEntityId();

describe("Product marketplace fields", () => {
  it("creates with gallery, sale price, slug and category", () => {
    const p = Product.create({
      storeId,
      name: "Selimut Bayi",
      price: 150000,
      images: ["a.jpg", "b.jpg"],
      salePrice: 120000,
      slug: "selimut-bayi",
      categoryId: createEntityId(),
    });

    expect(p.images).toEqual(["a.jpg", "b.jpg"]);
    expect(p.salePrice).toBe(120000);
    expect(p.slug).toBe("selimut-bayi");
    expect(p.effectivePrice).toBe(120000); // sale wins
    expect(p.coverImage).toBe("a.jpg");
  });

  it("effectivePrice falls back to price and coverImage to imageUrl", () => {
    const p = Product.create({ storeId, name: "X", price: 10000, imageUrl: "legacy.jpg" });
    expect(p.effectivePrice).toBe(10000);
    expect(p.coverImage).toBe("legacy.jpg");
  });

  it("rejects invalid sale price and slug", () => {
    expect(() => Product.create({ storeId, name: "X", price: 10000, salePrice: -5 })).toThrow();
    expect(() => Product.create({ storeId, name: "X", price: 10000, slug: "UPPER CASE" })).toThrow();
  });

  it("updateDetails handles new fields", () => {
    const p = Product.create({ storeId, name: "X", price: 10000 });
    p.updateDetails({ salePrice: 9000, slug: "x-promo", images: ["c.jpg"] });
    expect(p.salePrice).toBe(9000);
    expect(p.slug).toBe("x-promo");
    expect(p.images).toEqual(["c.jpg"]);
  });
});

describe("ProductVariant", () => {
  it("creates with inherited price when price is null", () => {
    const v = ProductVariant.create({ productId: createEntityId(), name: "Size M" });
    expect(v.price).toBeNull();
    expect(v.sortOrder).toBe(0);
  });

  it("rejects empty name and negative price", () => {
    expect(() => ProductVariant.create({ productId: createEntityId(), name: " " })).toThrow();
    expect(() => ProductVariant.create({ productId: createEntityId(), name: "S", price: -1 })).toThrow();
  });
});

describe("ProductCategory", () => {
  it("creates with slugified slug", () => {
    const c = ProductCategory.create({ storeId, name: "Blanket & Sleeping Buddy" });
    expect(c.slug).toBe("blanket-sleeping-buddy");
  });

  it("rejects empty name", () => {
    expect(() => ProductCategory.create({ storeId, name: " " })).toThrow();
  });
});
