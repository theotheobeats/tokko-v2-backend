import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { createAuth } from "../../lib/auth";
import { createDb } from "../../infrastructure/db/drizzle";
import type { Env } from "../../types";
import { eq } from "drizzle-orm";
import { stores } from "../../infrastructure/db/schema";

const authRouter = new Hono<{ Bindings: Env }>();

/** Full store payload matching the frontend Store interface. */
function serializeStoreRow(row: typeof stores.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    subdomain: row.subdomain,
    description: row.description,
    businessType: row.businessType,
    aestheticPreference: row.aestheticPreference,
    whatsappNumber: row.whatsappNumber,
    status: row.status,
    heroImageUrl: row.heroImageUrl,
  };
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const registerSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Invalid email"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

const loginSchema = z.object({
  email: z.string().email("Invalid email"),
  password: z.string().min(1, "Password is required"),
});

// ---------------------------------------------------------------------------
// POST /api/auth/register
// ---------------------------------------------------------------------------
authRouter.post("/register", zValidator("json", registerSchema), async (c) => {
  const { name, email, password } = c.req.valid("json");
  const auth = createAuth(c.env);

  try {
    const { headers } = await auth.api.signUpEmail({
      body: { name, email, password },
      headers: c.req.raw.headers,
      returnHeaders: true,
    });

    // Forward cookies from better-auth
    const setCookie = headers?.get("set-cookie");
    if (setCookie) {
      c.header("set-cookie", setCookie);
    }

    // Get session using the response headers that contain the new cookie
    const session = await auth.api.getSession({
      headers: new Headers({ cookie: setCookie ?? "" }),
    });

    return c.json({
      user: {
        id: session!.user.id,
        name: session!.user.name,
        email: session!.user.email,
      },
    }, 201);
  } catch (error: any) {
    console.error("REGISTER ERROR:", JSON.stringify(error, Object.getOwnPropertyNames(error)));
    if (error?.status === 422 || error?.message?.includes("already exists")) {
      return c.json({
        error: { code: "EMAIL_TAKEN", message: "Email sudah terdaftar. Silakan login." },
      }, 409);
    }
    return c.json({
      error: { code: "VALIDATION", message: error?.message ?? "Registration failed", detail: error?.cause?.message ?? "" },
    }, 400);
  }
});

// ---------------------------------------------------------------------------
// POST /api/auth/login
// ---------------------------------------------------------------------------
authRouter.post("/login", zValidator("json", loginSchema), async (c) => {
  const { email, password } = c.req.valid("json");
  const auth = createAuth(c.env);

  try {
    const { headers: authHeaders } = await auth.api.signInEmail({
      body: { email, password },
      headers: c.req.raw.headers,
      returnHeaders: true,
    });

    // Forward cookies
    const setCookie = authHeaders?.get("set-cookie");
    if (setCookie) {
      c.header("set-cookie", setCookie);
    }

    // Get the session to access user
    const session = await auth.api.getSession({ headers: c.req.raw.headers });

    if (!session) {
      return c.json({
        error: { code: "INVALID_CREDENTIALS", message: "Email atau password salah." },
      }, 401);
    }

    // Check if user has a store
    const db = createDb(c.env.DB);
    const storeRow = await db
      .select()
      .from(stores)
      .where(eq(stores.ownerId, session.user.id))
      .get();

    return c.json({
      user: {
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
      },
      store: storeRow ? serializeStoreRow(storeRow) : null,
    }, 200);
  } catch (error: any) {
    return c.json({
      error: { code: "INVALID_CREDENTIALS", message: "Email atau password salah." },
    }, 401);
  }
});

// ---------------------------------------------------------------------------
// POST /api/auth/logout
// ---------------------------------------------------------------------------
authRouter.post("/logout", async (c) => {
  const auth = createAuth(c.env);

  try {
    const { headers: authHeaders } = await auth.api.signOut({
      headers: c.req.raw.headers,
      returnHeaders: true,
    });

    const setCookie = authHeaders?.get("set-cookie");
    if (setCookie) {
      c.header("set-cookie", setCookie);
    }

    return c.json({ success: true });
  } catch {
    return c.json({ success: true }); // Always succeed
  }
});

// ---------------------------------------------------------------------------
// GET /api/auth/me
// ---------------------------------------------------------------------------
authRouter.get("/me", async (c) => {
  const auth = createAuth(c.env);
  const session = await auth.api.getSession({ headers: c.req.raw.headers });

  if (!session) {
    return c.json({ user: null, store: null }, 401);
  }

  // Check if user has a store
  const db = createDb(c.env.DB);
  const storeRow = await db
    .select()
    .from(stores)
    .where(eq(stores.ownerId, session.user.id))
    .get();

  return c.json({
    user: {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
    },
    store: storeRow ? serializeStoreRow(storeRow) : null,
  });
});

export { authRouter };
