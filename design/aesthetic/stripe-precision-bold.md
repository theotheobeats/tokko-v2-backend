# Stripe — Style Reference
> indigo-ink ledger on frosted glass

**Theme:** light
**Best for:** bold aesthetic, tech, financial, precision

A near-monochrome financial-instrument language: soft cool-white canvas with deep navy headings, almost no decorative chrome, and one vivid indigo (#533afd) that earns the right to be a button, link, or icon stroke. Typography is exclusively sohne-var at weight 300 — even at 56px display size — which reads as confident restraint rather than corporate shouting. The whole interface behaves like a ledger or terminal: dense information, crisp rules, generous whitespace, and color appearing only when something needs to be acted on.

## Color Palette

| Role | Value | Usage |
|------|-------|-------|
| Indigo Ink | `#533afd` | Filled buttons, active links, icon strokes |
| Midnight Ink | `#061b31` | Primary heading and body text |
| Slate | `#64748d` | Secondary text |
| Steel | `#50617a` | Tertiary body text |
| Canvas | `#ffffff` | Page background |
| Mist | `#f8fafd` | Footer band |
| Frost | `#e5edf5` | Borders, dividers |
| Lavender | `#b9b9f9` | Outline button border |
| Periwinkle | `#e8e9ff` | Highlighted cards, tag pills |

## Typography

- **Primary**: sohne-var (substitute: Inter Tight, weight 300/400)
- Display: 56px, weight 300, tracking -1.4px — headlines WHISPER instead of shout
- Body: 16px, weight 300-400
- Tabular numerals on (tnum) for metrics and pricing
- NO bold weights anywhere — weight 300 IS the identity

## Spacing & Shapes

- Base unit: 8px
- Button radius: 4px (deliberately not pill — reads as professional, not friendly)
- Card radius: 4px
- Tag radius: 9999px
- Section gap: 96px
- Page max-width: 1320px

## Key Patterns

- Hero: left-aligned text block at 56px — typography IS the hero, no image
- Sections separated by 1px #e5edf5 rules + 96px gaps
- Cards: white on white, no shadow, no border, distinguished only by layout
- Buttons: 4px radius, never pill, never shadow
- Metric blocks: enormous number at weight 300 ("quiet monument" effect)

## Do's
- #533afd exclusively for primary actions — never for body text or decoration
- All headings weight 300 — the whisper-weight is the signature
- Tighten letter-spacing as size grows
- 4px border-radius on all interactive elements
- 1px #e5edf5 dividers between sections

## Don'ts
- No shadows, blurs, or CSS elevation — depth from background tint only
- No additional accent colors — monochrome + one indigo
- No semibold/bold headings
- No rounded corners beyond 4px
- No centered text
