# Font Family Choice in Themes & Appearance

Yes — font family can be a first-class theming option, exactly like theme, density and accent. Right now the app names IBM Plex Sans / Archivo / JetBrains Mono as its fonts, but no web fonts are actually loaded in the root document, so the browser falls back to system faces. So this adds both real fonts and a way to choose them.

## What gets added

A new **Typeface** control in two places on the Themes & Appearance screen:

- **Organization Theme** — sets the default typeface for everyone.
- **My Appearance** — personal override with "Use organization default", so someone who finds the default hard to read can switch without changing anyone else's workspace.

Font scale (Small / Default / Large) stays as it is and works alongside the typeface choice.

## Typeface options (4 curated sets)

Each option pairs a UI face, a heading face, and a numeric/mono face (order numbers, quantities, prices stay tabular and unambiguous in every option).

1. **Precision** (current look) — IBM Plex Sans + Archivo + JetBrains Mono. Professional, technical.
2. **Rounded** — Nunito + Nunito (heavier weight for headings) + Roboto Mono. Thicker strokes, rounded terminals, friendly — the direction you described.
3. **Grotesk** — Manrope + Manrope Bold + IBM Plex Mono. Clean, slightly wide, high legibility at small sizes.
4. **High Legibility** — Atkinson Hyperlegible + Atkinson Hyperlegible Bold + JetBrains Mono. Designed specifically for readability; strongly distinguished letterforms (I / l / 1, O / 0), good for the shop floor and for anyone who finds the default fussy.

Each option is shown as a card with a live sample line ("Order #10671 — 24 pcs") so the difference is visible before selecting.

## Behavior

- Selecting a typeface updates the Live Preview immediately — navigation, headers, table, buttons, and form fields all re-render in that face.
- "Apply to this workspace" applies the effective typeface to the real app shell along with the other settings.
- Personal typeface shows the same "Inherited from organization" / "Personal override" badge and reset link as the other user settings.
- Storefront/customer typography is untouched — this is the employee workspace only.

## Technical notes

- Load the four families from Google Fonts via `links` in `src/routes/__root.tsx` head (subset to the weights used; `display=swap`). No CSS `@import` of URLs.
- Add a `[data-font="precision|rounded|grotesk|legible"]` block in `src/styles.css` that reassigns `--font-sans`, `--font-display`, and `--font-mono`. Because components already consume those tokens, no business module needs edits.
- Extend the appearance store with a `font` field so the app shell honors it; extend `PreviewSettings` in `src/components/app/theme-preview.tsx` with `font` and set `data-font` on the preview container.
- Add the typeface picker to `src/routes/_shell.appearance.tsx` in both scope panels, following the existing `Field` / `SegGroup` / inheritance pattern.

No changes to navigation, Production, Prepress, Sales, Fulfillment, permissions, or storefront.
