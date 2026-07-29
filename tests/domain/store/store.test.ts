import { describe, it, expect } from "vitest";
import { Store } from "../../../src/domain/store/store";
import { StoreStatus, BusinessType, Aesthetic } from "../../../src/domain/store/types";
import { createEntityId } from "../../../src/domain/shared/types";
import { generateSubdomain } from "../../../src/domain/store/rules";

const ownerId = createEntityId();

describe("Store aggregate", () => {
  // -----------------------------------------------------------------------
  // Creation
  // -----------------------------------------------------------------------
  describe("create()", () => {
    it("should create a store in draft status with default values", () => {
      const store = Store.create({
        ownerId,
        name: "Anna's Bakery",
        businessType: BusinessType.Food,
        aestheticPreference: Aesthetic.Warm,
        whatsappNumber: "+6281234567890",
      });

      expect(store.id).toBeDefined();
      expect(store.ownerId).toBe(ownerId);
      expect(store.name).toBe("Anna's Bakery");
      expect(store.status).toBe(StoreStatus.Draft);
      expect(store.productCount).toBe(0);
      expect(store.description).toBeNull();
      expect(store.heroImageUrl).toBeNull();
    });

    it("should auto-generate subdomain from business name", () => {
      const store = Store.create({
        ownerId,
        name: "Anna's Bakery",
        businessType: BusinessType.Food,
        aestheticPreference: Aesthetic.Warm,
        whatsappNumber: "+6281234567890",
      });

      expect(store.subdomain).toBe("annas-bakery");
    });

    it("should allow explicit subdomain override", () => {
      const store = Store.create({
        ownerId,
        name: "Anna's Bakery",
        businessType: BusinessType.Food,
        aestheticPreference: Aesthetic.Warm,
        whatsappNumber: "+6281234567890",
        subdomain: "custom-anna",
      });

      expect(store.subdomain).toBe("custom-anna");
    });

    it("should generate unique ID for each store", () => {
      const store1 = Store.create({ ownerId, name: "A", businessType: BusinessType.Food, aestheticPreference: Aesthetic.Warm, whatsappNumber: "+62" });
      const store2 = Store.create({ ownerId, name: "B", businessType: BusinessType.Food, aestheticPreference: Aesthetic.Warm, whatsappNumber: "+62" });

      expect(store1.id).not.toBe(store2.id);
    });
  });

  // -----------------------------------------------------------------------
  // Publishing
  // -----------------------------------------------------------------------
  describe("publish()", () => {
    it("should not publish a store with zero products", () => {
      const store = Store.create({
        ownerId,
        name: "Test Store",
        businessType: BusinessType.Service,
        aestheticPreference: Aesthetic.Minimal,
        whatsappNumber: "+62",
      });

      const result = store.publish();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain("at least one product");
      }
    });

    it("should publish when product count >= 1", () => {
      const store = Store.create({
        ownerId,
        name: "Test Store",
        businessType: BusinessType.Service,
        aestheticPreference: Aesthetic.Minimal,
        whatsappNumber: "+62",
      });

      store.setProductCount(3);
      const result = store.publish();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe(StoreStatus.Published);
      }
    });

    it("should return the store with published status", () => {
      const store = Store.create({
        ownerId,
        name: "Test Store",
        businessType: BusinessType.Service,
        aestheticPreference: Aesthetic.Minimal,
        whatsappNumber: "+62",
      });

      store.setProductCount(1);
      const result = store.publish();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.isPublished).toBe(true);
      }
    });
  });

  // -----------------------------------------------------------------------
  // Unpublishing
  // -----------------------------------------------------------------------
  describe("unpublish()", () => {
    it("should set status back to draft", () => {
      const store = Store.create({
        ownerId,
        name: "Test Store",
        businessType: BusinessType.Service,
        aestheticPreference: Aesthetic.Minimal,
        whatsappNumber: "+62",
      });

      store.setProductCount(5);
      store.publish();
      expect(store.status).toBe(StoreStatus.Published);

      store.unpublish();
      expect(store.status).toBe(StoreStatus.Draft);
    });
  });

  // -----------------------------------------------------------------------
  // Update details
  // -----------------------------------------------------------------------
  describe("updateDetails()", () => {
    it("should update name, description, and whatsapp", () => {
      const store = Store.create({
        ownerId,
        name: "Old Name",
        businessType: BusinessType.Fashion,
        aestheticPreference: Aesthetic.Bold,
        whatsappNumber: "+62OLD",
      });

      store.updateDetails({
        name: "New Name",
        description: "New description",
        whatsappNumber: "+62NEW",
      });

      expect(store.name).toBe("New Name");
      expect(store.description).toBe("New description");
      expect(store.whatsappNumber).toBe("+62NEW");
    });

    it("should only update provided fields", () => {
      const store = Store.create({
        ownerId,
        name: "Original",
        businessType: BusinessType.Craft,
        aestheticPreference: Aesthetic.Warm,
        whatsappNumber: "+62ORIG",
      });

      store.updateDetails({ name: "Renamed" });

      expect(store.name).toBe("Renamed");
      expect(store.whatsappNumber).toBe("+62ORIG"); // unchanged
      expect(store.description).toBeNull();         // unchanged
    });
  });

  // -----------------------------------------------------------------------
  // Hero image
  // -----------------------------------------------------------------------
  describe("setHeroImage()", () => {
    it("should set and clear hero image URL", () => {
      const store = Store.create({
        ownerId,
        name: "Store",
        businessType: BusinessType.Home,
        aestheticPreference: Aesthetic.Minimal,
        whatsappNumber: "+62",
      });

      store.setHeroImage("stores/abc123/hero.jpg");
      expect(store.heroImageUrl).toBe("stores/abc123/hero.jpg");

      store.setHeroImage(null);
      expect(store.heroImageUrl).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // Reconstitution
  // -----------------------------------------------------------------------
  describe("from()", () => {
    it("should reconstitute a store from persistent props", () => {
      const id = createEntityId();
      const store = Store.from({
        id,
        ownerId,
        name: "Reconstituted",
        subdomain: "recon",
        description: "A reconstituted store",
        businessType: BusinessType.Gadget,
        aestheticPreference: Aesthetic.Bold,
        whatsappNumber: "+62",
        status: StoreStatus.Published,
        heroImageUrl: "img.jpg",
        productCount: 10,
      });

      expect(store.id).toBe(id);
      expect(store.name).toBe("Reconstituted");
      expect(store.status).toBe(StoreStatus.Published);
      expect(store.productCount).toBe(10);
      expect(store.isPublished).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // toJSON
  // -----------------------------------------------------------------------
  describe("toJSON()", () => {
    it("should return a snapshot of all props", () => {
      const store = Store.create({
        ownerId,
        name: "Snapshot Store",
        businessType: BusinessType.Beauty,
        aestheticPreference: Aesthetic.Warm,
        whatsappNumber: "+62",
      });

      const json = store.toJSON();
      expect(json.id).toBe(store.id);
      expect(json.name).toBe("Snapshot Store");
      expect(json.status).toBe(StoreStatus.Draft);
      expect(json.productCount).toBe(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Business rule tests (pure functions)
// ---------------------------------------------------------------------------
describe("generateSubdomain", () => {
  it("should slugify 'Anna's Bakery' → 'annas-bakery'", () => {
    expect(generateSubdomain("Anna's Bakery")).toBe("annas-bakery");
  });

  it("should strip special characters and collapse spaces", () => {
    expect(generateSubdomain("Budi & Co.")).toBe("budi-co");
  });

  it("should collapse multiple hyphens", () => {
    expect(generateSubdomain("A   B   C")).toBe("a-b-c");
  });

  it("should trim to max 30 characters", () => {
    const long = "This Is A Very Very Very Very Very Long Business Name For A Store";
    const result = generateSubdomain(long);
    expect(result.length).toBeLessThanOrEqual(30);
  });

  it("should lowercase and trim", () => {
    expect(generateSubdomain("  HELLO WORLD  ")).toBe("hello-world");
  });
});
