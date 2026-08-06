import type { Context } from "hono";
import { createAuth } from "../../lib/auth";
import type { Env } from "../../types";

/**
 * Require an authenticated session (any user).
 *
 * Returns the better-auth session on success; a 401 Response on failure.
 * Callers must `return` the Response immediately:
 *
 *   const session = await requireUser(c);
 *   if (session instanceof Response) return session;
 */
export async function requireUser<E extends { Bindings: Env }>(c: Context<E>) {
  const auth = createAuth(c.env);
  const session = await auth.api.getSession({ headers: c.req.raw.headers });

  if (!session) {
    return c.json({ error: { code: "UNAUTHORIZED", message: "Silakan login terlebih dahulu." } }, 401);
  }

  return session;
}
