# Store Page Rendering — Frontend Contract (Component-Based)

The backend **no longer generates HTML**. The AI produces **structured content (pure JSON)**; the frontend maps each section's `type + variant` to a hand-designed component and feeds it `content` + `theme`.

This guarantees a quality floor (all markup is human-designed) while keeping every store unique (AI-written copy + AI-chosen theme + section arrangement).

---

## API shape

Every page endpoint returns a `Page`:

```ts
interface Page {
  id: string;
  storeId: string;
  sections: Section[];
  theme: Theme | null;         // was `designTokens` — renamed
}

interface Section {
  id: string;
  type: SectionType;           // "hero" | "about" | "product-grid" | "testimonial" | "cta" | "contact" | "faq"
  variant: string;             // which designed component to render (see table below)
  content: SectionContent;     // typed per section type (see below)
  sortOrder: number;
}

interface Theme {
  accent: string;
  bg: string;
  cardBg: string;
  text: string;
  textSecondary: string;
  ctaText: string;
  borderRadius: string;
  buttonRadius: string;
}
```

### Endpoints

| Endpoint | Method | Returns |
|---|---|---|
| `/api/stores/:storeId/page` | GET | `Page` |
| `/api/stores/by-subdomain?subdomain=` | GET | `{ store, sections: Section[], products, theme }` |
| `/api/stores/:storeId/page/regenerate` | POST | `Page` |
| `/api/stores/:storeId/page/sections` | POST | `{ section, page }` |
| `/api/stores/:storeId/page/sections/:id` | PATCH | `{ section, page }` |
| `/api/stores/:storeId/page/sections/:id` | DELETE | `Page` |
| `/api/stores/:storeId/page/reorder` | PATCH | `Page` |
| `/api/stores/generate` | POST | `{ store, page, products }` |

---

## Rendering

```tsx
function Storefront({ page }: { page: Page }) {
  const theme = page.theme ?? DEFAULT_THEME;
  return (
    <div style={{ background: theme.bg, color: theme.text }}>
      {page.sections
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((s) => <SectionRenderer key={s.id} section={s} theme={theme} />)}
    </div>
  );
}

function SectionRenderer({ section, theme }: { section: Section; theme: Theme }) {
  switch (section.type) {
    case "hero":         return <HeroSection variant={section.variant} content={section.content} theme={theme} />;
    case "about":        return <AboutSection variant={section.variant} content={section.content} theme={theme} />;
    case "product-grid": return <ProductGridSection variant={section.variant} content={section.content} theme={theme} />; // mounts live products
    case "testimonial":  return <TestimonialSection variant={section.variant} content={section.content} theme={theme} />;
    case "cta":          return <CtaSection variant={section.variant} content={section.content} theme={theme} />;
    case "contact":      return <ContactSection variant={section.variant} content={section.content} theme={theme} />;
    case "faq":          return <FaqSection variant={section.variant} content={section.content} theme={theme} />;
  }
}
```

Each section component switches on `variant` to pick the layout.

---

## Section types, variants, and content fields

### `hero` — variants: `split` | `centered` | `image-bg`
```ts
{ eyebrow?: string; title: string; subtitle: string; ctaText: string; imageUrl?: string }
```

### `about` — variants: `split` | `centered` | `stats`
```ts
{ eyebrow?: string; heading: string; body: string; imageUrl?: string;
  stats?: { value: string; label: string }[] }   // required when variant === "stats"
```

### `product-grid` — variants: `grid` | `list`
```ts
{ eyebrow?: string; heading: string }
// Live products are mounted by the frontend (from /products), NOT in content.
```

### `testimonial` — variants: `cards` | `single`
```ts
{ eyebrow?: string; heading: string;
  items: { quote: string; name: string; role?: string }[] }
```

### `cta` — variants: `band` | `card`
```ts
{ heading: string; subtitle?: string; ctaText: string }
```

### `contact` — variants: `split` | `centered`
```ts
{ eyebrow?: string; heading: string;
  whatsapp?: string; address?: string; email?: string; hours?: string }
```

### `faq` — variants: `accordion` | `grid`
```ts
{ eyebrow?: string; heading: string;
  items: { question: string; answer: string }[] }
```

---

## Editing (owner dashboard)

- Update a section's copy: `PATCH .../sections/:id` with `{ content: { ...partial } }` — merged into existing content. Optionally also pass `{ variant }` to switch layout.
- Add a section: `POST .../sections` with `{ type, variant, content, sortOrder? }`.
- Both return `{ section, page }` — replace your local page state with the returned `page`.

## Notes

- `theme` may be `null` for older stores — always fall back to a `DEFAULT_THEME`.
- `imageUrl` is usually absent (AI leaves it blank). Wire it to your R2-uploaded store images when available, else render a styled placeholder.
- There is **no `html` field anymore.** Do not `dangerouslySetInnerHTML` — render real components.
