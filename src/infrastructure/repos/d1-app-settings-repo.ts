import { eq } from "drizzle-orm";
import type { DbClient } from "../db/drizzle";
import { appSettings } from "../db/schema";

/** Key-value app settings (admin-switchable platform config). */
export interface AppSettingsRepository {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

export class D1AppSettingsRepository implements AppSettingsRepository {
  constructor(private readonly db: DbClient) {}

  async get(key: string): Promise<string | null> {
    const row = await this.db.select().from(appSettings).where(eq(appSettings.key, key)).get();
    return row?.value ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    await this.db
      .insert(appSettings)
      .values({ key, value })
      .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date().toISOString() } });
  }
}
