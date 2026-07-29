import { describe, it, expect } from "vitest";
import { Product } from "../../../src/domain/store/product";
import { createEntityId } from "../../../src/domain/shared/types";

const storeId = createEntityId();

describe("Product entity", () => {
  describe("create()", () => {
    it("should create a product with default values", () => {
      const product = Product.create({
        storeId,
        name: "Rainbow Cake",
        price: 85000,
      });

      expect(product.id).toBeDefined();
      expect(product.storeId).toBe(storeId);
      expect(product.name).toBe("Rainbow Cake");
      expect(product.price).toBe(85000);
      expect(product.isAvailable).toBe(true);
      expect(product.description).toBeNull();
      expect(product.imageUrl).toBeNull();
    });

    it("should trim the product name", () => {
      const product = Product.create({
        storeId,
        name: "  Rainbow Cake  ",
        price: 85000,
      });

      expect(product.name).toBe("Rainbow Cake");
    });

    it("should throw when name is empty", () => {
      expect(() =>
        Product.create({ storeId, name: "", price: 1000 })
      ).toThrow("Product name is required");

      expect(() =>
        Product.create({ storeId, name: "   ", price: 1000 })
      ).toThrow("Product name is required");
    });

    it("should throw when price is negative", () => {
      expect(() =>
        Product.create({ storeId, name: "Cake", price: -100 })
      ).toThrow("Price must be >= 0");
    });

    it("should accept price 0 (free item)", () => {
      const product = Product.create({ storeId, name: "Free Sample", price: 0 });
      expect(product.price).toBe(0);
    });

    it("should create with optional description and image", () => {
      const product = Product.create({
        storeId,
        name: "Cake",
        price: 50000,
        description: "Delicious",
        imageUrl: "images/cake.jpg",
      });

      expect(product.description).toBe("Delicious");
      expect(product.imageUrl).toBe("images/cake.jpg");
    });
  });

  describe("updatePrice()", () => {
    it("should update the price", () => {
      const product = Product.create({ storeId, name: "Cake", price: 50000 });
      product.updatePrice(75000);
      expect(product.price).toBe(75000);
    });

    it("should throw on negative price", () => {
      const product = Product.create({ storeId, name: "Cake", price: 50000 });
      expect(() => product.updatePrice(-1)).toThrow("Price must be >= 0");
    });

    it("should accept price 0", () => {
      const product = Product.create({ storeId, name: "Cake", price: 50000 });
      product.updatePrice(0);
      expect(product.price).toBe(0);
    });
  });

  describe("toggleAvailability()", () => {
    it("should toggle from available to unavailable", () => {
      const product = Product.create({ storeId, name: "Cake", price: 50000 });
      expect(product.isAvailable).toBe(true);

      product.toggleAvailability();
      expect(product.isAvailable).toBe(false);
    });

    it("should toggle back to available", () => {
      const product = Product.create({ storeId, name: "Cake", price: 50000 });
      product.toggleAvailability();
      product.toggleAvailability();
      expect(product.isAvailable).toBe(true);
    });
  });

  describe("updateDetails()", () => {
    it("should update name, description, and image", () => {
      const product = Product.create({ storeId, name: "Old", price: 1000 });
      product.updateDetails({
        name: "New Name",
        description: "New Desc",
        imageUrl: "new.jpg",
      });

      expect(product.name).toBe("New Name");
      expect(product.description).toBe("New Desc");
      expect(product.imageUrl).toBe("new.jpg");
    });

    it("should only update provided fields", () => {
      const product = Product.create({ storeId, name: "Original", price: 1000 });
      product.updateDetails({ description: "Added description" });

      expect(product.name).toBe("Original");
      expect(product.description).toBe("Added description");
      expect(product.imageUrl).toBeNull();
    });
  });

  describe("from()", () => {
    it("should reconstitute from persistent props", () => {
      const id = createEntityId();
      const product = Product.from({
        id,
        storeId,
        name: "Recon",
        description: "Desc",
        price: 999,
        imageUrl: "img.jpg",
        isAvailable: false,
      });

      expect(product.id).toBe(id);
      expect(product.isAvailable).toBe(false);
      expect(product.price).toBe(999);
    });
  });

  describe("toJSON()", () => {
    it("should return a snapshot", () => {
      const product = Product.create({
        storeId,
        name: "Snapshot",
        price: 42000,
        description: "Desc",
      });

      const json = product.toJSON();
      expect(json.name).toBe("Snapshot");
      expect(json.price).toBe(42000);
      expect(json.isAvailable).toBe(true);
    });
  });
});
