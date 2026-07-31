/**
 * Design Loader — maps user aesthetic preferences to design guide files.
 * Each call picks a random file from the matching category folder.
 * In production (Cloudflare Workers), files are bundled as ES modules.
 */

// ---------------------------------------------------------------------------
// Aesthetic → design folder mapping
// ---------------------------------------------------------------------------

export function mapAestheticToFolder(aesthetic: string): string {
  switch (aesthetic) {
    case "minimal":  return "minimalist";
    case "warm":     return "elegant";
    case "bold":     return "aesthetic";
    default:         return "elegant";
  }
}

// ---------------------------------------------------------------------------
// Design file registry — all files imported as raw strings
// ---------------------------------------------------------------------------

// Minimalist
import appleMinimal from "../../../design/minimalist/apple-minimal.md";
import linearMinimal from "../../../design/minimalist/linear-minimal-dark.md";
import raycastMinimal from "../../../design/minimalist/raycast-minimal-dark.md";
import oryzoMinimal from "../../../design/minimalist/oryzo-minimal-editorial.md";
import hyperstudioMinimal from "../../../design/minimalist/hyperstudio-minimal-dark.md";
import aurosMinimal from "../../../design/minimalist/auros-minimal-dark.md";

// Elegant
import notionElegant from "../../../design/elegant/notion-warm-editorial.md";
import elevenlabsElegant from "../../../design/elegant/elevenlabs-warm-editorial.md";
import steepElegant from "../../../design/elegant/steep-elegant-warm.md";
import cursorElegant from "../../../design/elegant/cursor-elegant-warm.md";
import monadElegant from "../../../design/elegant/monad-elegant-editorial.md";
import mercuryElegant from "../../../design/elegant/mercury-elegant-clean.md";
import uiElegant from "../../../design/elegant/ui-elegant-clinical.md";
import awesomicElegant from "../../../design/elegant/awesomic-elegant-editorial.md";

// Aesthetic
import duolingoAesthetic from "../../../design/aesthetic/duolingo-playful-bold.md";
import stripeAesthetic from "../../../design/aesthetic/stripe-precision-bold.md";
import monopoAesthetic from "../../../design/aesthetic/monopo-aesthetic-bold.md";
import authkitAesthetic from "../../../design/aesthetic/authkit-aesthetic-glass.md";
import giAesthetic from "../../../design/aesthetic/generalintelligence-aesthetic-literary.md";
import aibizAesthetic from "../../../design/aesthetic/aiforbusiness-aesthetic-brutalist.md";
import hungrytigerAesthetic from "../../../design/aesthetic/hungrytiger-aesthetic-food.md";

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const DESIGN_REGISTRY: Record<string, string[]> = {
  minimalist: [appleMinimal, linearMinimal, raycastMinimal, oryzoMinimal, hyperstudioMinimal, aurosMinimal],
  elegant: [notionElegant, elevenlabsElegant, steepElegant, cursorElegant, monadElegant, mercuryElegant, uiElegant, awesomicElegant],
  aesthetic: [duolingoAesthetic, stripeAesthetic, monopoAesthetic, authkitAesthetic, giAesthetic, aibizAesthetic, hungrytigerAesthetic],
};

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

/**
 * A guide under this many characters is too vague to steer the model —
 * it produces generic output. Rich guides (with concrete hex codes, font
 * sizes, spacing rules, do's/don'ts) are what make the output distinctive.
 */
const RICH_GUIDE_MIN_CHARS = 1500;

function isRichGuide(content: string): boolean {
  // Heuristic: a useful guide has several concrete hex colors and real detail.
  const hexCount = (content.match(/#[0-9a-fA-F]{6}/g) ?? []).length;
  return content.length >= RICH_GUIDE_MIN_CHARS && hexCount >= 4;
}

/**
 * Load a random design guide for the given aesthetic preference.
 * Prefers rich guides; logs a warning when only thin ones are available
 * so the generic-output root cause is visible in logs instead of silent.
 */
export function loadDesignGuide(aesthetic: string): string {
  const folder = mapAestheticToFolder(aesthetic);
  const guides = DESIGN_REGISTRY[folder] ?? DESIGN_REGISTRY.elegant;

  const rich = guides.filter(isRichGuide);
  const pool = rich.length > 0 ? rich : guides;

  if (rich.length === 0) {
    console.warn(
      `[design-loader] No rich design guides in "${folder}" (${guides.length} thin). ` +
      `AI output will likely be generic. Add concrete guides (hex codes, sizes, patterns).`
    );
  }

  const index = Math.floor(Math.random() * pool.length);
  return pool[index];
}
