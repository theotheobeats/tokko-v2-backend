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
 * Load a random design guide for the given aesthetic preference.
 * Returns the full markdown content of the selected design file.
 */
export function loadDesignGuide(aesthetic: string): string {
  const folder = mapAestheticToFolder(aesthetic);
  const guides = DESIGN_REGISTRY[folder] ?? DESIGN_REGISTRY.elegant;

  // Pick a random guide
  const index = Math.floor(Math.random() * guides.length);
  return guides[index];
}
