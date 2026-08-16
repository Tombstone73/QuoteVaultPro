# M2.UI0 — Lovable Visual Foundation

## Authority and source locations

The design-locked visual/interactions reference is deliberately retained at
`reference/lovable-ui`. It is comparison source, not runtime production code.
The real V2 browser application is `v2/ui`. The former may keep its mocked
store, TanStack-start routes, and future-workflow pages; none is imported as
business authority into V2.

Visual authority is the approved Lovable implementation: composition,
spacing, navigation, typography, colors, responsive treatment, and component
hierarchy. V2 remains authority for authenticated sessions, fresh principal
resolution, CSRF, tenant scope, React Query namespaces, API contracts,
permission checks, and commercial workflow state. A visual change never grants
business authority, and an object in a browser does not bypass the V2 API.

## Adopted shared foundation

`v2/ui/src/VisualShell.tsx` adopts the Lovable application shell composition:
a 216px collapsible sectioned sidebar, 48px top bar, shell navigation,
search treatment, new-action treatment, theme cycling, and authenticated
session presentation. The complete current Lovable navigation is rendered as
the only V2 shell; only Quotes, Orders, and Themes / Appearance currently have
V2 route targets. Other entries are intentionally inert, non-mutating visual
placeholders rather than paths to demo state or invented workflows.

`v2/ui/src/styles.css` imports the locked Lovable global stylesheet and its
CSS-variable/data-attribute token system. The V2 build uses its installed
Tailwind v4 Vite adapter, isolated from the repository root's V1 Tailwind v3
PostCSS configuration. `VisualShell` contains the small V2-specific bridge
selectors required to use that token system with the existing V2 React tree.

## Global theme model

`v2/ui/src/appearance.ts` owns a typed frontend-only `VisualAppearance` seam.
It preserves every approved Lovable option:

- themes: `light`, `dark`, `command`, `contrast`, `lowglare`, `warm`;
- density: `comfortable`, `compact`;
- accents: `blue`, `teal`, `amber`, `violet`, `red`;
- corners: `rounded`, `sharp`;
- fonts: `inter`, `segoe`, `arial`, `roboto`, `roboto-condensed`, `atkinson`;
- font scale, sidebar state, color-vision mapping, and enhanced status cues.

The provider applies the same document data attributes and CSS variables used
by the reference; it therefore changes the application shell and all pages
through a single global layer. It currently saves only an optional browser
preference (`ph.v2.visual-appearance`). That is intentionally not an
organization/user persistence model or a database fact. A future typed
preference API can replace this adapter without changing page components.
`AppearanceWorkspace` exposes the approved theme, density, corner, accent,
and typography choices without pretending organization persistence exists.

## Route and page mapping

| Reference page family | V2 status in M2.UI0 | Notes |
| --- | --- | --- |
| Quotes / Orders | Real backend, visually converging | Existing V2 React Query lists, edits, send, accept, conversion, draft invoice, and routing summaries remain authoritative. |
| Themes / Appearance | Frontend-only foundation | Global visual choices are applied immediately; durable preference policy is deferred. |
| Artwork | Future domain integration | M2.0 can provide ArtworkFile and tenant-scoped OrderLine assignments; a small frontend projection adapter is sufficient for file/usage/side/page/layer facts. |
| Proofing / Prepress / Production | Future domain | Reference screens use mock state and must not be wired before their domain milestones. |
| Customers, products, routing, fulfillment, finance, platform, admin | Mock/deferred or partially designed | They remain reference composition only until a V2 endpoint and permission-backed operation exists. |

The real Quote and Order editors use the approved sales-document composition:
document header/action rail, compact metadata treatment, Items/Artwork/Notes/
History tab strip, dense line table, and token-backed panels. Existing V2
controls, revision safety, capability gates, and error states remain in place;
no Lovable demo behavior is used as business state.

## Artwork compatibility

M2.0 already supplies the unambiguous facts needed by the reference Artwork
and future Prepress screens: durable file identity, purpose usage,
OrderLine attachment, derived lineage, side, source page, and layer identity.
The reference's artwork lists can be served by a tenant-bounded V2 projection
and a view-model adapter. Its Prepress screen additionally assumes mock
destination selection, completion/release state, thumbnails, viewer rendering,
and status transitions. Those are deliberately outside M2.UI0; no M2.0
persistence is changed to fit mock UI data.

## Validation and fidelity approach

The production V2 build compiles the adopted locked stylesheet. The focused UI
tests include the six-preset typed preference regression alongside existing
theme and Quote API/cache/permission tests. Visual comparison should run the
reference and V2 apps at fixed desktop and mobile viewports with authenticated
V2 fixtures once the local Node/npm Playwright runner is available. Compare
shell geometry, sidebar density, top bar, Quote/Order list hierarchy, theme
tokens, and responsive collapse—not live document values.

The reference source must not be deleted until every intended V2 page has
converged and screenshot regression coverage is established.

## Completion evidence

The local Lovable reference was built and run on loopback. Repository-local
Playwright captured reference Quotes, Orders, Appearance, and sales-detail
views plus authenticated V2 Quote and Order detail views at 1440x900. The
comparison covered shell geometry, sidebar density, top bar, document
headers/actions, metadata, tab strips, line-table hierarchy, and global
tokens. Live identifiers, values, and workflow notices are real-data
differences rather than visual drift.

## Deferred decisions and work

- **ARCHITECTURE DECISION REQUIRED:** durable organization defaults versus
  personal preference persistence. M2.UI0 intentionally has no database model.
  A future decision must define owner, visibility, precedence, audit, and
  permission semantics before a write API/migration is added.
- **UI DECISION REQUIRED:** future navigation entries currently have approved
  presentation but no V2 route/domain. M2.UI0 preserves their visual presence
  without inventing an unavailable-page experience. Before making any such
  entry operational, define whether it opens a read-only workspace, a gated
  empty state, or remains hidden until its domain milestone.
- Pixel screenshot comparison and fully faithful detailed Quote/Order editor
  convergence remain follow-up work; backend semantics are preserved now.
