# Tokko Design Library

21 design references collected from [styles.refero.design](https://styles.refero.design). Used by the AI as **inspiration**, not templates — each store generation produces a unique visual system.

## Aesthetic Categories

| Category | Files | Vibe |
|----------|-------|------|
| `minimalist/` | 6 | Clean, restrained, whitespace-forward. Apple, Linear, Raycast. |
| `elegant/` | 8 | Warm, editorial, paper-textured. Notion, ElevenLabs, Cursor, Steep. |
| `aesthetic/` | 7 | Bold, expressive, personality-driven. Duolingo, Stripe, monopo, Hungry Tiger. |

## How It Works

```
1. User submits quiz → businessName, businessType, aesthetic preference
2. DeepSeek analyzes → "food + warm → this belongs in /elegant/"
3. One design guide is selected from that folder (random or LLM-chosen)
4. The guide is injected as INSPIRATION reference, not a template
5. DeepSeek creates a UNIQUE visual system for this specific store
6. Two bakeries getting the same guide will STILL get different designs
```

## Prompt Injection

The design guide is injected into the system prompt with this prefix:

```
## DESIGN INSPIRATION

Below is a design reference from the [CATEGORY] aesthetic family. 
Study its tonal qualities — the warmth of its canvas, the restraint 
of its palette, the rhythm of its spacing, the personality of its 
typography. 

DO NOT copy the exact colors, sizes, fonts, radii, or layout values. 
Instead, create a NEW visual system that feels like it belongs in the 
same design family, adapted specifically for this business:

- Business: {businessName}
- Type: {businessType}
- Products: {productCategory}
- Target: Indonesian consumers, mobile-first

VARY these elements so every generated page is unique:
- Shift the primary accent hue by 5-15 degrees
- Adjust border-radius within ±30% of the reference
- Change the font pairing while keeping the same weight-to-weight ratio
- Modify section vertical rhythm by ±20%
- Pick a different-but-related canvas warmth level

## REFERENCE DESIGN
{selected design guide content}

## OUTPUT
Now generate a complete landing page. All copy in Bahasa Indonesia.
Use the reference above for TASTE, not exact values.
```

## Category Selection Logic

In the store generation prompt, the LLM first decides which folder to use:

```
Analyze this business profile and pick the best aesthetic category:
- businessType: {type}
- userPreference: {aesthetic}  

Categories:
- minimalist: Clean, lots of white space, single accent, typography-forward
- elegant: Warm, editorial, textured, sophisticated restraint
- aesthetic: Bold, expressive, colorful, personality-driven

Respond with just the category name.
```

Then a random file from that folder is loaded and injected.

## File Format

Each design file contains:
- One-line vibe description
- Color palette
- Typography scale
- Spacing & shapes
- Key layout patterns
- Do's and don'ts
- Best-for business types

All condensed to ~1KB for efficient LLM context usage.
