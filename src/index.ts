import { Hono } from "hono";
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
app.use("*", async (c, next) => {
  const env = c.env as Env;
  const extraOrigins = [
    ...(env.FRONTEND_URL ? [env.FRONTEND_URL] : []),
    ...(env.ALLOWED_ORIGINS?.split(",").map((s) => s.trim()).filter(Boolean) ?? []),
  ];
  const exactOrigins = [
    "http://localhost:3000",          // Next.js dev server
    "http://localhost:3001",          // Admin dev server
    "https://7okko.com",              // Production root domain
    "https://www.7okko.com",
    "https://admin.7okko.com",        // Admin panel
    ...extraOrigins,                  // Deployed frontend origin(s)
  ];
  // Store subdomains: https://<store>.7okko.com
  const STORE_SUBDOMAIN_RE = /^https:\/\/([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+7okko\.com$/;
  // Preview/workers.dev origins (staging frontend/admin workers.dev URLs).
  const WORKERS_DEV_RE = /^https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.workers\.dev$/;

  const origin = c.req.header("origin");
  const allowed =
    origin &&
    (exactOrigins.includes(origin) || STORE_SUBDOMAIN_RE.test(origin) || WORKERS_DEV_RE.test(origin))
      ? origin
      : undefined;

  // Headers are applied DIRECTLY to c.res.headers — after the handler runs
  // (see below) — so they survive even when a handler returns a raw Response
  // from another framework (better-auth's auth.handler()), which Hono's
  // c.header() does NOT merge into.
  const applyCors = () => {
    if (!allowed) return;
    c.res.headers.set("Access-Control-Allow-Origin", allowed);
    c.res.headers.set("Access-Control-Allow-Credentials", "true");
    // Chrome Private Network Access: required when the page is on a local/
    // private network (VPN, office) — otherwise the preflight fails with
    // "CORS request did not succeed" + a 204 missing-ACAO error.
    c.res.headers.set("Access-Control-Allow-Private-Network", "true");
    c.res.headers.set("Access-Control-Expose-Headers", "Content-Length");
    c.res.headers.set("Vary", "Origin");
  };

  // Preflight — explicit Response so the 204 ALWAYS carries the headers
  // (Hono's cors returns 204 without ACAO when its origin callback bails,
  // which browsers surface as "CORS header Access-Control-Allow-Origin missing").
  if (c.req.method === "OPTIONS" && c.req.header("access-control-request-method")) {
    const headers = new Headers({
      "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,Authorization",
      "Access-Control-Expose-Headers": "Content-Length",
      // Short cache: stale preflights from deploys clear in 60s instead of 10min.
      "Access-Control-Max-Age": "60",
    });
    if (allowed) {
      headers.set("Access-Control-Allow-Origin", allowed);
      headers.set("Access-Control-Allow-Credentials", "true");
      headers.set("Access-Control-Allow-Private-Network", "true");
    }
    headers.set("Vary", "Origin");
    return new Response(null, { status: 204, headers });
  }

  await next();
  // c.res is now the handler's response — apply CORS directly on its headers
  // so raw Responses (better-auth) get them too.
  applyCors();
});

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
import { regionsRouter } from "./interfaces/routes/regions";
import { ticketsRouter, reportsRouter } from "./interfaces/routes/support";
import { adminRouter } from "./interfaces/routes/admin";
import { paymentsRouter } from "./interfaces/routes/payments";
import { categoriesRouter } from "./interfaces/routes/categories";
import { shippingRouter } from "./interfaces/routes/shipping";
import { plansRouter } from "./interfaces/routes/plans";
app.route("/api/stores", storesRouter);
app.route("/api/stores", productsRouter);
app.route("/api/stores", ordersRouter);
app.route("/api/stores", pagesRouter);
app.route("/api", uploadsRouter); // /api/images/:key + /api/stores/:id/upload
app.route("/api/regions", regionsRouter); // public Indonesian region cascade
app.route("/api", ticketsRouter); // /api/tickets/* (user-facing support)
app.route("/api", reportsRouter); // /api/stores/:storeId/report (public moderation)
app.route("/api/admin", adminRouter); // admin panel (requireAdmin guard)
app.route("/api", paymentsRouter); // payments + Xendit webhook
app.route("/api/stores", categoriesRouter); // product categories
app.route("/api/stores", shippingRouter); // Biteship shipping rates + origin settings
app.route("/api/plans", plansRouter); // pre-store plan purchase (signup gate)

// ---------------------------------------------------------------------------
// Export — worker entry (fetch + cron scheduled)
// ---------------------------------------------------------------------------
import { runTrialLifecycle } from "./interfaces/cron/trial-lifecycle";

export default {
  // Hono's fetch must be bound so `this` stays the app instance.
  fetch: app.fetch.bind(app),
  /** Daily trial-lifecycle job: day-10 reminder, day-14 pause, >30d archive. */
  async scheduled(_event: unknown, env: Env, _ctx: unknown) {
    try {
      const result = await runTrialLifecycle(env);
      console.log("[cron] trial lifecycle:", JSON.stringify(result));
    } catch (err) {
      console.error("[cron] trial lifecycle failed:", err);
    }
  },
};
