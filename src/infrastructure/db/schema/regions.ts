import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

/**
 * Indonesian administrative regions — Kepmendagri No 300.2.2-2430 (2025).
 *
 * One table for all four levels; `code` is the official dotted code and its
 * length implies the level:
 *   2  digits  → provinsi        (level 1)
 *   5  chars   → kabupaten/kota  (level 2)   e.g. "11.01"
 *   8  chars   → kecamatan       (level 3)   e.g. "11.01.01"
 *   13 chars   → kelurahan/desa  (level 4)   e.g. "11.01.01.2001"
 *
 * `parentCode` points at the containing region (NULL for provinces).
 * `kodepos` is filled only on level-4 rows (from POS Indonesia data).
 */
export const regions = sqliteTable(
  "regions",
  {
    code: text("code").primaryKey(),
    name: text("name").notNull(),
    level: integer("level").notNull(),
    parentCode: text("parent_code"),
    kodepos: text("kodepos"),
  },
  (t) => [
    index("idx_regions_parent").on(t.parentCode),
    index("idx_regions_level").on(t.level),
  ],
);
