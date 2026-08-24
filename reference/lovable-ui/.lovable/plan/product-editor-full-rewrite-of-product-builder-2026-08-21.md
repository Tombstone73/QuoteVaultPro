# Product Editor — full rewrite of Product Builder

Replace the 6-step Product Builder wizard with a single dense **Product Editor** workspace that covers everything from the legacy screenshots, in the current PrintersHero V2 visual language (Panels, `section-panel`/`section-label`, dense tables, 12–13px type, semantic tokens, all themes).

## Layout

```text
┌ sticky editor bar: name · Draft/Active toggle · Cancel Duplicate Discard Save ┐
├─────────────────────────────── main column ────────────┬── right rail ───────┤
│ 1 Basic Information                                    │ PRICING PREVIEW     │
│ 2 AI Parsing                                           │  inputs W/H/Qty     │
│ 3 Pricing Engine  (Basic | Advanced)                   │  output / blockers  │
│ 4 Material & Weight + Finished Size + flags            │  weight debug       │
│ 5 Option Groups → Options → Choices                    │  live options list  │
│ 6 Option Rules (plain-language cards)                  │  VALIDATION         │
└────────────────────────────────────────────────────────┴─────────────────────┘
```

Section nav is a compact sticky jump strip (not a wizard) so nothing is hidden behind steps. Right rail is sticky, collapsible, and recomputes as fields change.

## Sections

**1. Basic Information** — shop/internal name, description, category, product type (Sheet/Roll/Garment/Service), Service-Fee switch, order measurements (Dimensions required / Quantity only), workflow intent (Standard production / Fulfillment only / Billing only), with the inline explanatory helper text. Workflow intent visibly drives which downstream flags below are enabled.

**2. AI Parsing** — "use product description" checkbox that disables the separate textarea, plus a Generate-with-AI button (mock fill) and helper copy.

**3. Pricing Engine** — Basic/Advanced segmented control. Basic shows rate per sq ft, rate per piece, minimum charge, tier basis, units. Advanced adds the three-way source picker (Formula Library / Pricing Profile / Custom Formula) as radio cards where only the selected one expands, an "Available pricing variables" reference disclosure, rotation/mixed-sheet-layout switch, and Quantity Tiers / Size Tiers tabs with add-row editing.

**4. Material & Weight** — primary material select, resolved-weight readout, shipping policy, fallback weight/unit/basis (disabled with a reason when a material weight exists), Finished Size trim allowances, and the four flags (Requires Proof Approval, Requires Production Job, Allow $0.00, Taxable).

**5. Option Groups** — left list of groups (drag to reorder, count + Required/$ markers, Add Group / Import Template) and a right detail pane: group name, description, Required-group and Multi-select switches, group visibility summary, then the group's Options. Each option expands to label, help text, input type, required, and its **Choices**. A choice row expands to label/value, variant-defining vs additive-modifier tags, pricing override, variant price delta, resolved material override (with the "weight not configured" warning), workflow context tags, pricing impacts, and materials/inventory rows with quantity basis.

**6. Option Rules — plain-language cards.** This is the biggest usability change. Instead of hand-writing 10+ then/else actions, each rule reads as one sentence built from selects:

```text
When [Pole Pockets] [is] [Yes]  →  show + require [Pole Pocket Location] [Pole Pocket Depth]
Otherwise: hidden, optional, and cleared automatically.        [Enabled] [⋯]
```

- Effects are chosen from intent presets (Show & require / Show only / Hide / Set default), and the inverse (hide + optional + clear) is generated automatically and shown as read-only summary text.
- Targets are multi-select chips, so one card replaces the legacy 4 then-actions + 9 else-actions.
- Rules render as a readable list; affected options in section 5 get a small "conditional" marker linking back to the rule.
- No raw advanced then/else editor in this pass (the presets cover the pole-pocket cases).

**Pricing Preview & Validation rail** — width/height/quantity inputs, computed price or a clear "select required options before pricing" blocker listing the missing groups, weight-debug key/value list behind a disclosure, live option selects mirroring the configured groups (respecting rules — pole pocket children appear only when Yes), and a validation panel listing coded findings (e.g. `PBV2_W_WEIGHT_MISSING`) with severity tone and jump-to-field links.

## Data & wiring

- New `src/lib/mock/product-editor.ts`: types for product type / measurements / workflow intent, option groups → options → choices, rule cards, pricing config, materials/weight, plus seeded **Coroplast** (thickness, double-sided, grommets, contour cutting) and **Banner with pole pockets** (Pole Pockets → Location/Depth/Custom Depth) fixtures, and pure helpers for rule evaluation, required-option checks, validation findings, and preview pricing.
- Rewrite `src/routes/_shell.product-builder.tsx` as the editor; accept an optional `?product=<id>` search param so `/products/$id` "Edit" opens the right fixture, and update the products list / detail links accordingly.
- New components under `src/components/app/product-editor/`: `option-groups.tsx`, `option-choice.tsx`, `rule-cards.tsx`, `pricing-engine.tsx`, `pricing-preview.tsx`.
- All state is local React state (prototype); no backend. Save/Publish shows a toast. Existing pages, shell, themes, and pricing behavior elsewhere stay untouched.
