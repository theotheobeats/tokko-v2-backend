/**
 * LLM Client — OpenAI-compatible (works with any provider).
 *
 * Supported providers (set via LLM_BASE_URL env):
 *   - DeepSeek (default):    https://api.deepseek.com/v1
 *   - Synthetic / Kimi K3:   https://api.synthetic.new/openai/v1
 *   - OpenAI:                https://api.openai.com/v1
 *   - Any OpenAI-compatible  http://your-endpoint/v1
 *
 * Uses standard fetch() — no SDK needed. Works in Cloudflare Workers.
 */

import type { AIGeneratedPage } from "../../application/store/generate-store";
import { buildStorePrompt } from "./prompts/store-generator";
import { PRODUCT_DESCRIPTION_PROMPT } from "./prompts/product-description";
import { loadDesignGuide } from "./design-loader";
import {
  SECTION_DEFINITIONS,
  ThemeSchema,
  type SectionKind,
} from "../../domain/store/section-content";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

interface LlmConfig {
  apiKey: string;
  model?: string;
  baseUrl?: string;
}

const DEFAULT_BASE_URL = "https://api.deepseek.com/v1";
const DEFAULT_MODEL = "deepseek-chat";

// ---------------------------------------------------------------------------
// Core client (OpenAI-compatible — works with any provider)
// ---------------------------------------------------------------------------

async function chatCompletion(
  config: LlmConfig,
  messages: { role: "system" | "user"; content: string }[],
  options?: { jsonMode?: boolean; maxTokens?: number; temperature?: number }
): Promise<string> {
  const baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model ?? DEFAULT_MODEL,
      messages,
      temperature: options?.temperature ?? 0.7,
      // Store pages are large (5 sections + 5 products) AND the model spends
      // tokens on internal reasoning, so the output ceiling must be generous —
      // 8192 could truncate mid-string → unparseable JSON.
      max_tokens: options?.maxTokens ?? 16000,
      ...(options?.jsonMode ? { response_format: { type: "json_object" } } : {}),
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "Unknown error");
    throw new Error(`LLM API error ${response.status}: ${errText.slice(0, 200)}`);
  }

  const data = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
  };

  return data.choices[0]?.message?.content ?? "";
}

// ---------------------------------------------------------------------------
// Store generation
// ---------------------------------------------------------------------------

/**
 * Generate a complete store page + sample products from quiz answers.
 */
export interface GenerateStoreInput {
  businessName: string;
  businessType: string;
  productCategory: string;
  aesthetic: string;
  /** Blocks used last time — regenerate picks different ones (anti-repeat). */
  previousBlocks?: Array<{ type: string; blockId: string }>;
  /** Theme tokens used last time — regenerate varies the theme. */
  previousTheme?: Record<string, string>;
}

/** Rotating creative directions to push each generation into a different space. */
const CREATIVE_DIRECTIONS = [
  "Sangat minimal & bersih, banyak ruang kosong, tipografi besar.",
  "Hangat & personal, menonjolkan cerita pemilik dan sentuhan lokal.",
  "Bold & modern, warna aksen kuat, tata letak editorial yang berani.",
  "Elegan & premium, tone mewah, detail halus, fokus kualitas.",
  "Ceria & playful, energik, ramah, cocok untuk brand muda.",
  "Fokus pada bukti sosial & kepercayaan (testimoni, angka nyata bila ada).",
];

export async function generateStore(
  config: LlmConfig,
  input: GenerateStoreInput
): Promise<AIGeneratedPage> {
  // Load a random design guide for this aesthetic
  const designGuide = loadDesignGuide(input.aesthetic);
  const systemPrompt = buildStorePrompt(designGuide, input.aesthetic);

  // Per-call variation: pick a creative direction + random seed so consecutive
  // regenerations explore different layouts/copy instead of converging.
  const direction = CREATIVE_DIRECTIONS[Math.floor(Math.random() * CREATIVE_DIRECTIONS.length)];
  const seed = Math.random().toString(36).slice(2, 8);

  const userMessage = JSON.stringify({
    namaBisnis: input.businessName,
    jenisBisnis: input.businessType,
    kategoriProduk: input.productCategory,
    gayaDesain: input.aesthetic,
    arahKreatif: direction,
    variasiId: seed,
    ...(input.previousBlocks?.length ? { blokSebelumnya: input.previousBlocks } : {}),
    ...(input.previousTheme ? { temaSebelumnya: input.previousTheme } : {}),
  });

  // LLM output is inherently non-deterministic — a single call can come back
  // truncated or with a malformed structure. Retry (with a slightly calmer
  // temperature) before surfacing a failure to the user.
  for (let attempt = 1; attempt <= 3; attempt++) {
    const raw = await chatCompletion(
      config,
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      { jsonMode: true, temperature: attempt === 1 ? 0.8 : 0.5 }
    );
    try {
      return parseStoreResponse(raw);
    } catch (err: any) {
      console.error(`PARSE ERROR (attempt ${attempt}/3):`, err.message);
      console.error("RAW RESPONSE (first 500 chars):", raw.slice(0, 500));
    }
  }
  throw new Error("AI response is not valid JSON after 3 attempts");
}

// ---------------------------------------------------------------------------
// Product description generation
// ---------------------------------------------------------------------------

/**
 * Generate a product description from name + category.
 */
export async function generateProductDesc(
  config: LlmConfig,
  input: { name: string; category: string }
): Promise<string> {
  const raw = await chatCompletion(
    config,
    [
      { role: "system", content: PRODUCT_DESCRIPTION_PROMPT },
      { role: "user", content: `Produk: ${input.name}\nKategori: ${input.category}` },
    ],
    { maxTokens: 200, temperature: 0.7 }
  );

  return raw.trim();
}

// ---------------------------------------------------------------------------
// JSON repair — handles newlines in string values (common DeepSeek quirk)
// ---------------------------------------------------------------------------

function repairJsonNewlines(raw: string): string {
  let result = "";
  let inString = false;
  let escaped = false;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];

    if (escaped) {
      result += ch;
      escaped = false;
      continue;
    }

    if (ch === "\\") {
      result += ch;
      escaped = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      result += ch;
      continue;
    }

    if (inString && (ch === "\n" || ch === "\r")) {
      // Inside a JSON string value — escape the newline
      if (ch === "\n") result += "\\n";
      // Skip \r (or handle as needed)
      continue;
    }

    result += ch;
  }

  return result;
}

/**
 * Extract the outermost balanced {...} JSON object from a raw LLM response.
 * Handles leading prose, markdown fences, and trailing prose. Returns the
 * substring from the first '{' to its matching '}', or null if unbalanced.
 */
function extractJsonObject(raw: string): string | null {
  const start = raw.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return raw.slice(start, i + 1);
    }
  }

  // Unbalanced — likely truncated. Return null so caller can fail clearly.
  return null;
}

// ---------------------------------------------------------------------------
// Response parser
// ---------------------------------------------------------------------------

function parseStoreResponse(raw: string): AIGeneratedPage {
  let parsed: unknown;

  // Attempt 1: strict parse.
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Attempt 2: extract the outermost balanced {...} then repair newlines.
    const extracted = extractJsonObject(raw);
    if (extracted) {
      try {
        parsed = JSON.parse(repairJsonNewlines(extracted));
      } catch {
        // fall through
      }
    }
    if (parsed === undefined) {
      try {
        parsed = JSON.parse(repairJsonNewlines(raw));
      } catch {
        console.error("RAW RESPONSE (first 800 chars):", raw.slice(0, 800));
        throw new Error("AI response is not valid JSON");
      }
    }
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("AI response is not an object");
  }

  const data = parsed as Record<string, unknown>;

  if (!Array.isArray(data.sections)) throw new Error("AI response missing 'sections' array");
  if (!Array.isArray(data.sampleProducts)) throw new Error("AI response missing 'sampleProducts' array");

  // Validate + normalize each section against its content schema.
  const sections: AIGeneratedPage["sections"] = [];
  for (const s of data.sections as Array<Record<string, unknown>>) {
    const type = s.type as SectionKind;
    const def = SECTION_DEFINITIONS[type];
    if (!def) continue;

    const variant = typeof s.variant === "string" && (def.variants as readonly string[]).includes(s.variant)
      ? s.variant
      : def.variants[0]; // fall back to first variant

    const contentRaw = (s.content && typeof s.content === "object" ? s.content : {}) as Record<string, unknown>;
    const contentParsed = def.content.safeParse(contentRaw);
    if (!contentParsed.success) continue; // skip malformed sections

    sections.push({ type, variant, content: contentParsed.data as Record<string, unknown> });
  }

  if (sections.length === 0) {
    throw new Error("AI response has no valid sections");
  }

  // Ensure the mandatory section types are always present (footer included).
  // The AI sometimes drops sections when the prompt is long — fill defaults
  // so the page is always complete and always ends with a footer.
  // NOTE: numeric/metric fields (stats, ratings) are intentionally left empty
  // so we never fabricate numbers — the owner fills real data in the editor.
  const MANDATORY_TYPES: SectionKind[] = ["hero", "about", "product-grid", "contact", "footer"];
  const DEFAULT_CONTENT: Record<string, Record<string, unknown>> = {
    hero: { blockId: "hero-shadcn-centered", eyebrow: "Selamat Datang", title: "Produk Terbaik untuk Anda", subtitle: "Kualitas premium dengan harga terjangkau. Pesan sekarang!", ctaText: "Pesan Sekarang" },
    about: { blockId: "about-shadcn-centered", eyebrow: "Tentang Kami", heading: "Kenapa Memilih Kami", body: "Kami berkomitmen memberikan produk dan layanan terbaik untuk kepuasan Anda." },
    "product-grid": { blockId: "product-grid-shadcn-cards", eyebrow: "Koleksi Kami", heading: "Produk Andalan" },
    contact: { blockId: "contact-shadcn-cards", eyebrow: "Kontak", heading: "Hubungi Kami", whatsapp: "", address: "Alamat toko", hours: "08.00 - 20.00" },
    footer: { blockId: "footer-simple-centered", tagline: "Terima kasih sudah berbelanja!" },
  };
  const existingTypes = new Set(sections.map((s) => s.type));
  for (const t of MANDATORY_TYPES) {
    if (!existingTypes.has(t)) {
      const def = SECTION_DEFINITIONS[t];
      sections.push({ type: t, variant: def.variants[0], content: DEFAULT_CONTENT[t] });
    }
  }

  // Validate + sanitize products
  const sampleProducts = (data.sampleProducts as Array<Record<string, unknown>>)
    .filter((p) => typeof p.name === "string" && typeof p.price === "number")
    .map((p) => ({
      name: p.name as string,
      description: typeof p.description === "string" ? p.description : "",
      price: Math.max(0, Math.round(p.price as number)),
    }))
    .slice(0, 5);

  if (sampleProducts.length === 0) {
    throw new Error("AI response has no valid products");
  }

  // Theme: validate with zod → fall back to defaults for any missing/invalid fields.
  const themeSrc = (data.theme && typeof data.theme === "object"
    ? data.theme
    : data.designTokens) as Record<string, unknown> | undefined;

  const themeParsed = ThemeSchema.safeParse(themeSrc ?? {});
  const theme = themeParsed.success
    ? themeParsed.data
    : FALLBACK_THEME;

  // Flatten to string-keyed map (the rest of the system expects Record<string,string>).
  const designTokens: Record<string, string> = {};
  for (const [k, v] of Object.entries(theme)) {
    designTokens[k] = String(v);
  }

  return { sections, sampleProducts, designTokens };
}

const FALLBACK_THEME = ThemeSchema.parse({
  accent: "#f97316",
  bg: "#fdfcfa",
  cardBg: "#ffffff",
  text: "#1c1917",
  textSecondary: "#78716c",
  ctaText: "#ffffff",
  borderRadius: "12px",
  buttonRadius: "9999px",
  fontStyle: "modern-sans",
  spacing: "comfortable",
  elevation: "subtle-shadow",
  decorDensity: "moderate",
  layoutStyle: "startup",
});

// ---------------------------------------------------------------------------
// Mock (fallback for development without API key)
// ---------------------------------------------------------------------------

export { mockAIGenerate } from "./llm-client";
