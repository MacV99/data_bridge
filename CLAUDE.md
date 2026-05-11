# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm dev        # Dev server at localhost:4321
pnpm build      # Production build → ./dist/
pnpm preview    # Preview built site
```

## Architecture

**Stack:** Astro 5 (no UI framework) + Supabase (PostgreSQL) + vanilla JavaScript.  
**Language:** Spanish UI. No TypeScript in component scripts (`.astro` files use plain JS).

### Data flow

```
Supabase DB
  └── lib/database.js   ← all CRUD (getCampaigns, createCampaign, updateCampaign,
                                     updateCampaignStatus, deleteCampaign)
        └── lib/supabase.js   ← client init (PUBLIC_SUPABASE_URL / PUBLIC_SUPABASE_ANON_KEY)
```

Pages and components import from `lib/database.js` directly. There is no state library — module-level variables (`allCampaigns`, `editingCampaignId`) hold runtime state.

### Component communication (custom events)

| Event | Emitter | Listener | Payload |
|---|---|---|---|
| `campaignAdded` | `create_city.astro` | `index.astro` | none |
| `editCampaign` | `index.astro` | `create_city.astro` | campaign object |
| `initializeDuplas` | `index.astro` / `header.astro` | `create_city.astro` | none |

### Key files

- `src/pages/index.astro` — Dashboard: two-column layout (Pendientes / Montadas), card rendering, modals for detail/delete, all event wiring.
- `src/components/create_city.astro` — Add/Edit form modal. Handles image compression (canvas, 800×800, JPEG 70%), audio conversion to MP3 (Web Audio API + lamejs CDN).
- `src/sections/header.astro` — Top nav with project title and "+ campaign" button.
- `src/layouts/Layout1.astro` — HTML shell: Google Fonts (Montserrat), Bootstrap Icons CDN, view transitions.
- `src/styles/global.css` — Design tokens as CSS variables, utility classes (`.boton`, `.boton2`, `.flex-row`, `.flex-column`, `.spinner`, `.skeleton`).
- `src/styles/project.css` — Component styles (modals, scrollbars, cards).

### Data model (Supabase)

**campaigns:** `id, city_name, start_date, phone_number, audio_url, status ("pendiente"|"montada"), created_at`  
**duplas:** `id, campaign_id (FK cascade), name, image_url, text, dupla_order`

Images and audio are stored as base64 data URLs directly in Supabase columns.

### Rendering pattern

All campaign cards and modals are built via template literals injected into `innerHTML`. Event listeners are re-attached after each render via `addEventListeners()`. There is no virtual DOM or diffing.

## Design tokens (global.css)

```css
--clr-accent     /* primary accent color */
--clr-dark       /* #101010 page background */
--clr-dark2      /* card/input background */
--clr-gray       /* muted text */
--clr-text       /* body text */
--clr-border     /* border/hover */
--clr-white      /* headings */
```

To retheme, change `--clr-accent` and the grayscale variables. Accent is used for buttons, badges, and highlights throughout both CSS files.
