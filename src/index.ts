import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { createAuth } from "./lib/auth";
import type { Env } from "./types";

// Extend Hono's context variables with user + session
type Variables = {
  user: Record<string, unknown> | null;
  session: Record<string, unknown> | null;
};

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// ---------------------------------------------------------------------------
// Global middleware
// ---------------------------------------------------------------------------
app.use(logger());
app.use(
  "*",
  cors({
    origin: [
      "http://localhost:3000",        // Next.js dev server
      "https://tokko.com",            // Production dashboard
    ],
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    exposeHeaders: ["Content-Length"],
    maxAge: 600,
    credentials: true,
  })
);

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------
app.get("/", (c) => c.json({ status: "ok", name: "tokko-api" }));

// ---------------------------------------------------------------------------
// Custom auth routes — must come BEFORE better-auth's wildcard handler
// ---------------------------------------------------------------------------
import { authRouter } from "./interfaces/routes/auth";
app.route("/api/auth", authRouter);

// ---------------------------------------------------------------------------
// Better-auth handler — catch-all for built-in auth endpoints
// ---------------------------------------------------------------------------
app.on(["POST", "GET"], "/api/auth/*", (c) => {
  const auth = createAuth(c.env);
  return auth.handler(c.req.raw);
});

// ---------------------------------------------------------------------------
// Auth middleware — attaches user + session to context
// ---------------------------------------------------------------------------
app.use("/api/*", async (c, next) => {
  // Skip auth routes themselves
  if (c.req.path.startsWith("/api/auth")) {
    return next();
  }

  const auth = createAuth(c.env);
  const session = await auth.api.getSession({ headers: c.req.raw.headers });

  if (!session) {
    c.set("user", null);
    c.set("session", null);
  } else {
    c.set("user", session.user);
    c.set("session", session.session);
  }

  return next();
});

// ---------------------------------------------------------------------------
// Application routes
// ---------------------------------------------------------------------------
import { storesRouter } from "./interfaces/routes/stores";
import { productsRouter } from "./interfaces/routes/products";
import { ordersRouter } from "./interfaces/routes/orders";
import { pagesRouter } from "./interfaces/routes/pages";
import { uploadsRouter } from "./interfaces/routes/uploads";
app.route("/api/stores", storesRouter);
app.route("/api/stores", productsRouter);
app.route("/api/stores", ordersRouter);
app.route("/api/stores", pagesRouter);
app.route("/api", uploadsRouter); // /api/images/:key + /api/stores/:id/upload

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------
export default app;
