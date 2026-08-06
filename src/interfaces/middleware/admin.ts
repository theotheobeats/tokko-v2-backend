import type { Context } from "hono";
import { createAuth } from "../../lib/auth";
import type { Env } from "../../types";

/**
 * Require an authenticated admin session.
 *
 * Returns the better-auth session on success (use it for adminId); returns a
 * Response (401 / 403) on failure — callers must `return` it immediately:
 *
 *   const session = await requireAdmin(c);
 *   if (session instanceof Response) return session;
 *
 * Ban enforcement: banned users cannot access admin endpoints at all, even if
 * their role is still "admin" (ban overrides role).
 */
export async function requireAdmin<E extends { Bindings: Env }>(c: Context<E>) {
  const auth = createAuth(c.env);
  const session = await auth.api.getSession({ headers: c.req.raw.headers });

  if (!session) {
    return c.json({ error: { code: "UNAUTHORIZED", message: "Silakan login terlebih dahulu." } }, 401);
  }

  const user = session.user as { role?: string | null; banned?: boolean };
  if (user.banned) {
    return c.json({ error: { code: "BANNED", message: "Akun ini diblokir." } }, 403);
  }
  if (user.role !== "admin") {
    return c.json({ error: { code: "FORBIDDEN", message: "Akses khusus admin." } }, 403);
  }

  return session;
}
