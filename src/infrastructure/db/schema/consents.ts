import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

/**
 * Catatan persetujuan (consent log) — bukti persetujuan UU PDP.
 *
 * UU PDP Pasal 22 & 24: persetujuan harus tertulis/terekam dan pengendali data
 * wajib menunjukkan bukti persetujuan. Setiap pendaftaran mencatat: pengguna,
 * jenis & versi dokumen yang disetujui, IP, user-agent, dan waktu.
 */
export const consents = sqliteTable(
  "consents",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    /** Jenis persetujuan, mis. "terms_privacy". */
    type: text("type").notNull(),
    /** Versi Syarat & Ketentuan yang disetujui. */
    termsVersion: text("terms_version").notNull(),
    /** Versi Kebijakan Privasi yang disetujui. */
    privacyVersion: text("privacy_version").notNull(),
    /** Alamat IP saat persetujuan diberikan (untuk audit). */
    ip: text("ip"),
    /** User-agent saat persetujuan diberikan (untuk audit). */
    userAgent: text("user_agent"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (t) => [index("consents_user_idx").on(t.userId)],
);
