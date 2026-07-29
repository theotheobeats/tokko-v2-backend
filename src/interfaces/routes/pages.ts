import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { createAuth } from "../../lib/auth";
import { createDb } from "../../infrastructure/db/drizzle";
import type { Env } from "../../types";
import { GetPage } from "../../application/page/get-page";
import { UpdateSection } from "../../application/page/update-section";
import { AddSection } from "../../application/page/add-section";
import { RemoveSection } from "../../application/page/remove-section";
import { ReorderSections } from "../../application/page/reorder-sections";
import { D1PageRepository } from "../../infrastructure/repos/d1-page-repo";
import { D1StoreRepository } from "../../infrastructure/repos/d1-store-repo";
import type { EntityId } from "../../domain/shared/types";

const pagesRouter = new Hono<{ Bindings: Env }>();

async function requireAuth(c: any) {
  const auth = createAuth(c.env);
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) {
    return c.json({ error: { code: "UNAUTHORIZED", message: "Silakan login terlebih dahulu." } }, 401);
  }
  return session;
}

async function verifyOwner(c: any, storeId: EntityId) {
  const session = await requireAuth(c);
  if (session instanceof Response) return session;

  const db = createDb(c.env.DB);
  const storeRepo = new D1StoreRepository(db);
  const store = await storeRepo.findById(storeId);

  if (!store) return c.json({ error: { code: "NOT_FOUND", message: "Toko tidak ditemukan." } }, 404);
  if (store.ownerId !== session.user.id) {
    return c.json({ error: { code: "FORBIDDEN", message: "Hanya pemilik toko." } }, 403);
  }
  return store;
}

// ---------------------------------------------------------------------------
// GET /api/stores/:storeId/page
// ---------------------------------------------------------------------------
pagesRouter.get("/:storeId/page", async (c) => {
  const storeId = c.req.param("storeId") as EntityId;
  const db = createDb(c.env.DB);

  // Public if store is published, else auth
  const storeRepo = new D1StoreRepository(db);
  const store = await storeRepo.findById(storeId);
  if (!store) return c.json({ error: { code: "NOT_FOUND" } }, 404);

  if (!store.isPublished) {
    const session = await requireAuth(c);
    if (session instanceof Response) return session;
    if (store.ownerId !== session.user.id) {
      return c.json({ error: { code: "FORBIDDEN" } }, 403);
    }
  }

  const pageRepo = new D1PageRepository(db);
  const useCase = new GetPage(pageRepo);
  const result = await useCase.execute({ storeId });

  if (!result.ok) return c.json({ error: { code: "UNKNOWN" } }, 500);
  return c.json(result.value);
});

// ---------------------------------------------------------------------------
// PATCH /api/stores/:storeId/page/sections/:id
// ---------------------------------------------------------------------------
pagesRouter.patch("/:storeId/page/sections/:id", zValidator("json", z.object({
  data: z.record(z.string(), z.unknown()),
})), async (c) => {
  const storeId = c.req.param("storeId") as EntityId;
  const sectionId = c.req.param("id") as EntityId;
  const ownerCheck = await verifyOwner(c, storeId);
  if (ownerCheck instanceof Response) return ownerCheck;

  const db = createDb(c.env.DB);
  const pageRepo = new D1PageRepository(db);
  const { data } = c.req.valid("json");

  const useCase = new UpdateSection(pageRepo);
  const result = await useCase.execute({ storeId, sectionId, data });

  if (!result.ok) {
    const status = result.error.code === "SECTION_NOT_FOUND" ? 404 : 404;
    return c.json({ error: result.error }, status);
  }

  return c.json({ section: result.value });
});

// ---------------------------------------------------------------------------
// POST /api/stores/:storeId/page/sections
// ---------------------------------------------------------------------------
pagesRouter.post("/:storeId/page/sections", zValidator("json", z.object({
  type: z.enum(["hero", "about", "product-grid", "testimonial", "cta", "contact", "faq"]),
  data: z.record(z.string(), z.unknown()),
  sortOrder: z.number().int().min(0).optional(),
})), async (c) => {
  const storeId = c.req.param("storeId") as EntityId;
  const ownerCheck = await verifyOwner(c, storeId);
  if (ownerCheck instanceof Response) return ownerCheck;

  const db = createDb(c.env.DB);
  const pageRepo = new D1PageRepository(db);
  const input = c.req.valid("json");

  const useCase = new AddSection(pageRepo);
  const result = await useCase.execute({
    storeId,
    type: input.type,
    data: input.data,
    sortOrder: input.sortOrder,
  });

  if (!result.ok) {
    return c.json({ error: result.error }, 404);
  }

  return c.json({ section: result.value.sections[result.value.sections.length - 1] }, 201);
});

// ---------------------------------------------------------------------------
// DELETE /api/stores/:storeId/page/sections/:id
// ---------------------------------------------------------------------------
pagesRouter.delete("/:storeId/page/sections/:id", async (c) => {
  const storeId = c.req.param("storeId") as EntityId;
  const sectionId = c.req.param("id") as EntityId;
  const ownerCheck = await verifyOwner(c, storeId);
  if (ownerCheck instanceof Response) return ownerCheck;

  const db = createDb(c.env.DB);
  const pageRepo = new D1PageRepository(db);

  const useCase = new RemoveSection(pageRepo);
  const result = await useCase.execute({ storeId, sectionId });

  if (!result.ok) {
    return c.json({ error: result.error }, 404);
  }

  return c.json({ sections: result.value.sections });
});

// ---------------------------------------------------------------------------
// PATCH /api/stores/:storeId/page/reorder
// ---------------------------------------------------------------------------
pagesRouter.patch("/:storeId/page/reorder", zValidator("json", z.object({
  sectionIds: z.array(z.string()),
})), async (c) => {
  const storeId = c.req.param("storeId") as EntityId;
  const ownerCheck = await verifyOwner(c, storeId);
  if (ownerCheck instanceof Response) return ownerCheck;

  const db = createDb(c.env.DB);
  const pageRepo = new D1PageRepository(db);
  const { sectionIds } = c.req.valid("json");

  const useCase = new ReorderSections(pageRepo);
  const result = await useCase.execute({
    storeId,
    sectionIds: sectionIds as EntityId[],
  });

  if (!result.ok) {
    return c.json({ error: result.error }, 404);
  }

  return c.json({ sections: result.value.sections });
});

// ---------------------------------------------------------------------------
// POST /api/stores/:storeId/page/regenerate
// ---------------------------------------------------------------------------
pagesRouter.post("/:storeId/page/regenerate", async (c) => {
  const storeId = c.req.param("storeId") as EntityId;
  const ownerCheck = await verifyOwner(c, storeId);
  if (ownerCheck instanceof Response) return ownerCheck;

  const db = createDb(c.env.DB);
  const pageRepo = new D1PageRepository(db);
  const { RegeneratePage } = await import("../../application/page/regenerate-page");

  // Use mock AI — replace with real LLM call
  const mockAI = async () => ({
    sections: [
      { type: "hero", data: { title: "Selamat Datang", subtitle: "Produk berkualitas", ctaText: "Pesan" } },
      { type: "about", data: { heading: "Tentang Kami", text: "Kami hadir untuk Anda." } },
      { type: "product-grid", data: { heading: "Produk" } },
      { type: "contact", data: { heading: "Kontak", whatsappNumber: "-", address: "-", hours: "-" } },
    ],
  });

  const useCase = new RegeneratePage(pageRepo, mockAI);
  const result = await useCase.execute({ storeId });

  if (!result.ok) {
    const status = result.error.code === "PAGE_NOT_FOUND" ? 404 : 422;
    return c.json({ error: result.error }, status);
  }

  return c.json({ page: result.value });
});

export { pagesRouter };
