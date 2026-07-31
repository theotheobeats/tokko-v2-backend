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
      // Store pages are large (5 sections × inline-CSS HTML + 5 products).
      // 2048 truncates the payload mid-string → unparseable. Default to 8192.
      max_tokens: options?.maxTokens ?? 8192,
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
export async function generateStore(
  config: LlmConfig,
  input: {
    businessName: string;
    businessType: string;
    productCategory: string;
    aesthetic: string;
  }
): Promise<AIGeneratedPage> {
  // Load a random design guide for this aesthetic
  const designGuide = loadDesignGuide(input.aesthetic);
  const systemPrompt = buildStorePrompt(designGuide, input.aesthetic);

  const userMessage = JSON.stringify({
    namaBisnis: input.businessName,
    jenisBisnis: input.businessType,
    kategoriProduk: input.productCategory,
    gayaDesain: input.aesthetic,
  });

  const raw = await chatCompletion(
    config,
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
    { jsonMode: true, temperature: 0.8 }
  );

  try {
    return parseStoreResponse(raw);
  } catch (err: any) {
    console.error("PARSE ERROR:", err.message);
    console.error("RAW RESPONSE (first 500 chars):", raw.slice(0, 500));
    throw err;
  }
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

  // Ensure the 4 mandatory section types are always present.
  // The AI sometimes drops sections when the prompt is long — fill defaults
  // so the page is always complete and never missing hero/about/products/contact.
  const MANDATORY_TYPES: SectionKind[] = ["hero", "about", "product-grid", "contact"];
  const DEFAULT_CONTENT: Record<string, Record<string, unknown>> = {
    hero: { blockId: "hero-shadcn-centered", eyebrow: "Selamat Datang", title: "Produk Terbaik untuk Anda", subtitle: "Kualitas premium dengan harga terjangkau. Pesan sekarang!", ctaText: "Pesan Sekarang" },
    about: { blockId: "about-shadcn-centered", eyebrow: "Tentang Kami", heading: "Kenapa Memilih Kami", body: "Kami berkomitmen memberikan produk dan layanan terbaik untuk kepuasan Anda.", stats: [{ value: "500+", label: "Pelanggan" }, { value: "4.9", label: "Rating" }] },
    "product-grid": { blockId: "product-grid-shadcn-cards", eyebrow: "Koleksi Kami", heading: "Produk Andalan" },
    contact: { blockId: "contact-shadcn-cards", eyebrow: "Kontak", heading: "Hubungi Kami", whatsapp: "", address: "Alamat toko", hours: "08.00 - 20.00" },
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
  fontStyle: "sans-clean",
  spacing: "comfortable",
  elevation: "subtle-shadow",
  decorDensity: "moderate",
  layoutStyle: "startup",
});

// ---------------------------------------------------------------------------
// Mock (fallback for development without API key)
// ---------------------------------------------------------------------------

export { mockAIGenerate } from "./llm-client";
