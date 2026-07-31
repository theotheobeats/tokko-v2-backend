# Auros — Style Reference
> abyssal terminal with phosphor glow

**Theme:** dark
**Best for:** minimal aesthetic, tech, gadget, finance, data products

Auros is a terminal window at the bottom of the ocean: pure black canvas, phosphor-green (#22c55e) text glowing like a CRT, and data laid out with machine calm. Every element is monochrome except the green, which marks live values, CTAs, and active states. Type is monospaced, corners are slightly rounded (8px) like a terminal window, and the whole page hums with quiet technical confidence.

## Color Palette

| Role | Value | Usage |
|------|-------|-------|
| Abyss Black | `#050505` | Page canvas — true black |
| Terminal Panel | `#0d0f0d` | Card/console surfaces |
| Phosphor Green | `#22c55e` | CTAs, live values, active accents |
| CRT White | `#e8f0e8` | Headlines, primary text (slight green tint) |
| Dim Phosphor | `#6b7f6b` | Body copy, secondary text |
| Scanline | `#1a1f1a` | Borders, grid lines |
| Green Glow | `rgba(34,197,94,0.15)` | Highlight washes, glow |

## Typography

- **Primary**: JetBrains Mono / ui-monospace (substitute: monospace), weights 400-700
- Display: 44-60px, weight 700, tracking -0.01em
- Section heading: 28-34px, weight 700
- Body: 14-15px, weight 400, line-height 1.7
- Labels: 12px, weight 500, uppercase, 0.06em tracking

## Spacing & Shapes

- Card radius: 8px (terminal window edge)
- Button radius: 6px
- Section gap: 80-112px
- Page max-width: 1100px
- 1px #1a1f1a scanline borders; glow only on green

## Key Patterns

- Hero: monospace headline → green CTA that glows (box-shadow: 0 0 24px rgba(34,197,94,0.4))
- Cards: #0d0f0d terminal panels, 8px radius, scanline border
- Data/metrics: phosphor green values on black, tabular figures
- Buttons: solid green fill or green outline on black, 6px radius
- Status dots and cursors: small green square/circle accents

## Do's
- True black canvas with green phosphor accents
- Monospace type throughout — it's the identity
- Green glow (box-shadow) on primary actions only
- Data-forward layouts with generous black space

## Don'ts
- No warm tones — everything cool green/black
- No decorative imagery or illustrations
- No rounded-pill buttons — terminal rectangles
- No second accent color — green only
