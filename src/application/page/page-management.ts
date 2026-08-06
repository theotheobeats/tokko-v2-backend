/**
 * Page management use cases — free-form multi-page stores.
 */

import type { EntityId } from "../../domain/shared/types";
import type { Result } from "../../domain/shared/types";
import { ok, err } from "../../domain/shared/types";
import { HOME_SLUG, Page } from "../../domain/store/page";
import { Section, type SectionType } from "../../domain/store/section";
import type { PageRepository, PageMeta } from "../../infrastructure/repos/d1-page-repo";
import { serializePage, type SerializedPage } from "./render-section";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class PageNotFoundError extends Error {
  code = "PAGE_NOT_FOUND";
  constructor() {
    super("Halaman tidak ditemukan");
  }
}

export class PageSlugTakenError extends Error {
  code = "PAGE_SLUG_TAKEN";
  constructor(slug: string) {
    super(`Slug "${slug}" sudah dipakai`);
  }
}

export class PageSlugInvalidError extends Error {
  code = "PAGE_SLUG_INVALID";
  constructor() {
    super("Slug hanya boleh huruf kecil, angka, dan tanda hubung (2-40 karakter)");
  }
}

export class LastPageError extends Error {
  code = "LAST_PAGE";
  constructor() {
    super("Tidak bisa menghapus halaman terakhir");
  }
}

// ---------------------------------------------------------------------------
// Slug validation
// ---------------------------------------------------------------------------

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isValidSlug(slug: string): boolean {
  return slug.length >= 2 && slug.length <= 40 && SLUG_RE.test(slug) && slug !== HOME_SLUG;
}

// ---------------------------------------------------------------------------
// Page templates — seeded sections for common page types
// ---------------------------------------------------------------------------

export type PageTemplate = "about" | "products" | "contact" | "faq" | "empty";

interface TemplateSection {
  type: SectionType;
  blockId: string;
  content: Record<string, unknown>;
}

const TEMPLATES: Record<Exclude<PageTemplate, "empty">, TemplateSection[]> = {
  about: [
    {
      type: "about",
      blockId: "about-shadcn-centered",
      content: { eyebrow: "✦ Tentang Kami", heading: "Kenapa Memilih Kami", body: "Ceritakan kisah dan nilai bisnismu di sini." },
    },
    {
      type: "cta",
      blockId: "cta-shadcn-band",
      content: { heading: "Siap Bekerja Sama?", ctaText: "Hubungi Kami" },
    },
    {
      type: "contact",
      blockId: "contact-shadcn-cards",
      content: { eyebrow: "✦ Kontak", heading: "Hubungi Kami", whatsapp: "" },
    },
  ],
  products: [
    {
      type: "product-grid",
      blockId: "product-grid-shadcn-cards",
      content: { eyebrow: "✦ Koleksi", heading: "Produk Andalan" },
    },
  ],
  contact: [
    {
      type: "contact",
      blockId: "contact-shadcn-cards",
      content: { eyebrow: "✦ Kontak", heading: "Hubungi Kami", whatsapp: "" },
    },
    {
      type: "faq",
      blockId: "faq-shadcn-accordion",
      content: { eyebrow: "✦ FAQ", heading: "Pertanyaan Umum", items: [] },
    },
  ],
  faq: [
    {
      type: "faq",
      blockId: "faq-shadcn-accordion",
      content: { eyebrow: "✦ FAQ", heading: "Pertanyaan Umum", items: [] },
    },
    {
      type: "cta",
      blockId: "cta-shadcn-band",
      content: { heading: "Masih Ada Pertanyaan?", ctaText: "Tanya Kami" },
    },
  ],
};

function seedSections(template: PageTemplate | undefined): Section[] {
  if (!template || template === "empty") return [];
  const defs = TEMPLATES[template] ?? [];
  return defs.map((d, i) =>
    Section.create({
      type: d.type,
      variant: "default",
      content: { ...d.content, blockId: d.blockId },
      sortOrder: i,
    })
  );
}

// ---------------------------------------------------------------------------
// AddPage
// ---------------------------------------------------------------------------

export class AddPage {
  constructor(private readonly pageRepo: PageRepository) {}

  async execute(input: { storeId: EntityId; slug: string; title?: string; template?: PageTemplate }): Promise<
    Result<{ page: SerializedPage; pages: PageMeta[] }, PageSlugInvalidError | PageSlugTakenError>
  > {
    const slug = input.slug.trim();
    if (!isValidSlug(slug)) return err(new PageSlugInvalidError());

    const existing = await this.pageRepo.findByStoreIdAndSlug(input.storeId, slug);
    if (existing) return err(new PageSlugTakenError(slug));

    const page = Page.create(input.storeId, seedSections(input.template), slug, input.title);
    await this.pageRepo.save(page);

    const designTokens = await this.pageRepo.getDesignTokens(input.storeId);
    const pages = await this.pageRepo.listByStoreId(input.storeId);
    return ok({ page: serializePage(page, designTokens), pages });
  }
}

// ---------------------------------------------------------------------------
// UpdatePage (rename slug/title)
// ---------------------------------------------------------------------------

export class UpdatePage {
  constructor(private readonly pageRepo: PageRepository) {}

  async execute(input: { storeId: EntityId; slug: string; newSlug?: string; title?: string | null }): Promise<
    Result<{ page: SerializedPage; pages: PageMeta[] }, PageNotFoundError | PageSlugInvalidError | PageSlugTakenError>
  > {
    const page = await this.pageRepo.findByStoreIdAndSlug(input.storeId, input.slug);
    if (!page) return err(new PageNotFoundError());

    const newSlug = input.newSlug?.trim() ?? input.slug;
    if (newSlug !== input.slug) {
      if (!isValidSlug(newSlug)) return err(new PageSlugInvalidError());
      const clash = await this.pageRepo.findByStoreIdAndSlug(input.storeId, newSlug);
      if (clash) return err(new PageSlugTakenError(newSlug));
    }

    page.rename(newSlug, input.title);
    await this.pageRepo.save(page);

    const designTokens = await this.pageRepo.getDesignTokens(input.storeId);
    const pages = await this.pageRepo.listByStoreId(input.storeId);
    return ok({ page: serializePage(page, designTokens), pages });
  }
}

// ---------------------------------------------------------------------------
// DeletePage
// ---------------------------------------------------------------------------

export class DeletePage {
  constructor(private readonly pageRepo: PageRepository) {}

  async execute(input: { storeId: EntityId; slug: string }): Promise<
    Result<{ pages: PageMeta[] }, PageNotFoundError | LastPageError>
  > {
    const page = await this.pageRepo.findByStoreIdAndSlug(input.storeId, input.slug);
    if (!page) return err(new PageNotFoundError());

    const count = await this.pageRepo.countByStoreId(input.storeId);
    if (count <= 1) return err(new LastPageError());

    await this.pageRepo.delete(page.id);
    const pages = await this.pageRepo.listByStoreId(input.storeId);
    return ok({ pages });
  }
}
