# Notion — Style Reference
> warm paper notebook under afternoon sun

**Theme:** light
**Best for:** warm aesthetic, editorial, content-heavy pages

Notion reads like a well-loved paper notebook under afternoon light: a warm off-white canvas (#f6f5f4) that feels tactile rather than clinical, generous sans typography that gives editorial weight to product copy, and color used as sparse punctuation — peachy pills highlight verbs, a single blue anchors the primary action, and a rotating cast of accent hues (coral, amber, sky, midnight) paints the feature card backgrounds like sticky notes. Cards sit on the canvas with 1px hairline borders and 12px corners — no shadows, no chrome — like ruled sections in a Moleskine. Motion is playful and springy, with 200ms ease transitions and bouncy character-mark animations that make the interface feel alive without ever being decorative.

## Color Palette

| Role | Value | Usage |
|------|-------|-------|
| Primary CTA | `#0075de` | Filled action buttons — the single chromatic commitment |
| Page Canvas | `#f6f5f4` | Warm off-white base for entire page |
| Card Surface | `#ffffff` | White cards on warm canvas |
| Primary Text | `#000000` | Built through alpha: 100%/95%/60%/40% |
| Accent Yellow | `#ffb110` | Hero pills, feature card backgrounds |
| Accent Coral | `#f64932` | Decorative card backgrounds |
| Accent Blue | `#097fe8` | Secondary blue accent |
| Dark Card | `#02093a` | Midnight violet for contrast panels |

## Typography

- **Primary**: Inter (NotionInter), weights 400-700
- Display: 72-96px, tight negative tracking (-2 to -4.6px)
- Body: 16px, line-height 1.5
- No serif body text

## Spacing & Shapes

- Base unit: 4px
- Card radius: 12px
- Button radius: 8px
- Pill radius: 9999px
- Section gap: 80px
- Page max-width: 1440px

## Key Patterns

- Hero: large headline with a colored highlight pill wrapping one word
- Feature cards: white on warm canvas, 1px hairline border, no shadow
- Colored accent panels: full-bleed background fills (yellow, coral, blue)
- Section headers: 48-54px, weight 500-700, tight letter-spacing
- CTA: filled blue `#0075de` (the ONLY filled button color)

## Do's
- Use `#f6f5f4` as canvas, `#ffffff` for cards
- Reserve `#0075de` for single primary action per screen
- Build text hierarchy through alpha on `#000000`, not different colors
- Use 1px borders at `rgba(0,0,0,0.08)` instead of shadows
- Keep motion at 200ms ease

## Don'ts
- No pure white page background
- No shadows on content cards
- No multiple chromatic button colors
- No gradients (strictly flat fills)
