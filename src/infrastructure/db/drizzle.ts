import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

/**
 * Creates a Drizzle client using the D1 binding.
 * Usage in Hono routes: `const db = createDb(c.env.DB)`
 */
export function createDb(d1Binding: D1Database) {
  return drizzle(d1Binding, { schema });
}

/** Inferred type for the Drizzle client with all schemas */
export type DbClient = ReturnType<typeof createDb>;
