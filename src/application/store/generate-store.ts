/**
 * GenerateStore use case — AI-powered store generation from quiz answers.
 */

import type { EntityId } from "../../domain/shared/types";
import type { Result } from "../../domain/shared/types";
import { ok, err } from "../../domain/shared/types";
import { Store } from "../../domain/store/store";
import { Product } from "../../domain/store/product";
import { Page } from "../../domain/store/page";
import { Section, SectionType, type SectionData } from "../../domain/store/section";
import { SubdomainAlreadyTakenError } from "../../domain/store/rules";
import type { StoreRepository } from "./store-repo";
import type { ProductRepository } from "../../infrastructure/repos/d1-product-repo";
import type { PageRepository } from "../../infrastructure/repos/d1-page-repo";
import type { Aesthetic, BusinessType } from "../../domain/store/types";

// ---------------------------------------------------------------------------
// Input / Output
// ---------------------------------------------------------------------------

export interface GenerateStoreInput {
  ownerId: EntityId;
  businessName: string;
  businessType: BusinessType;
  productCategory: string;
  aesthetic: Aesthetic;
  whatsappNumber: string;
}

export interface GenerateStoreOutput {
  store: ReturnType<Store["toJSON"]>;
  page: ReturnType<Page["toJSON"]>;
  products: ReturnType<Product["toJSON"]>[];
}

// ---------------------------------------------------------------------------
// AI Generation result shape
// ---------------------------------------------------------------------------

export interface AIGeneratedPage {
  sections: Array<{
    type: string;
    data: Record<string, unknown>;
  }>;
  sampleProducts: Array<{
    name: string;
    description: string;
    price: number;
  }>;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class AIGenerationFailedError extends Error {
  constructor(reason: string) {
    super(`AI generation failed: ${reason}`);
    this.name = "AIGenerationFailedError";
  }
}

// ---------------------------------------------------------------------------
// Use Case
// ---------------------------------------------------------------------------

export class GenerateStore {
  constructor(
    private readonly storeRepo: StoreRepository,
    private readonly productRepo: ProductRepository,
    private readonly pageRepo: PageRepository,
    private readonly aiGenerate: (input: { businessName: string; businessType: string; productCategory: string; aesthetic: string }) => Promise<AIGeneratedPage>,
  ) {}

  async execute(input: GenerateStoreInput): Promise<Result<GenerateStoreOutput, SubdomainAlreadyTakenError | AIGenerationFailedError>> {
    // 1. Check subdomain availability
    const subdomain = Store.create({
      ownerId: input.ownerId,
      name: input.businessName,
      businessType: input.businessType,
      aestheticPreference: input.aesthetic,
      whatsappNumber: input.whatsappNumber,
    }).subdomain;

    const existing = await this.storeRepo.findBySubdomain(subdomain);
    if (existing) {
      return err(new SubdomainAlreadyTakenError(subdomain));
    }

    // 2. Call AI to generate page + products
    let aiResult: AIGeneratedPage;
    try {
      aiResult = await this.aiGenerate({
        businessName: input.businessName,
        businessType: input.businessType,
        productCategory: input.productCategory,
        aesthetic: input.aesthetic,
      });
    } catch (error: any) {
      return err(new AIGenerationFailedError(error?.message ?? "Unknown error"));
    }

    // 3. Create Store aggregate
    const store = Store.create({
      ownerId: input.ownerId,
      name: input.businessName,
      businessType: input.businessType,
      aestheticPreference: input.aesthetic,
      whatsappNumber: input.whatsappNumber,
    });

    // 4. Create sample Products
    const products = aiResult.sampleProducts.map((p) =>
      Product.create({
        storeId: store.id,
        name: p.name,
        description: p.description,
        price: p.price,
      })
    );

    // Set product count (for publish invariant)
    store.setProductCount(products.length);

    // 5. Create Page with sections
    const sections = aiResult.sections.map((s, i) =>
      Section.create(s.type as SectionType, s.data as unknown as SectionData, i)
    );
    const page = Page.create(store.id, sections);

    // 6. Persist in transaction-like fashion (D1 doesn't support real transactions in workers, but we can do sequential writes)
    await this.storeRepo.save(store);
    await Promise.all(products.map((p) => this.productRepo.save(p)));
    await this.pageRepo.save(page);

    return ok({
      store: store.toJSON(),
      page: page.toJSON(),
      products: products.map((p) => p.toJSON()),
    });
  }
}
