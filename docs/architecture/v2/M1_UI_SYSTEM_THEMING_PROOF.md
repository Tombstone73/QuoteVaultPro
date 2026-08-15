# M1.7.5 UI System / Theming Proof

`v2/ui` is an isolated Vite/React application. It reuses repository-level React,
React Query, and Vite dependencies only; it imports no V1 client code, theme
provider, routes, or business components. Its future deployment artifact is
`dist-v2-ui`; a future V2 DEV host must serve it behind the trusted session
host (or an equivalent same-site/CSRF-safe authentication boundary) and proxy
`/v2` to the V2 runtime.

## UI ownership and theme resolution

The UI system owns semantic component structure and interaction. Themes map
semantic variables to values. Organization branding is a constrained overlay
over only `primary`, `secondary`, and wordmark—not success, warning,
destructive, focus, or disabled semantics. User preference is separately
`light`, `dark`, or `system`.

`resolveTheme(theme, preference, branding, systemDark)` is pure and follows:

`semantic contract + named appearance palette + allowed branding = CSS variables`.

Brand colors accept only six-digit hexadecimal values. The resolver derives a
readable foreground for accepted primary/secondary colors and ignores malformed
values. It never permits branding to replace protected status, focus, or
disabled semantics. The root uses typed preference and branding-provider seams:
the local browser adapter is proof-only; Settings will become the authoritative
source later.

The proof fixtures are PrintersHero default, clean corporate, and industrial
dark. They render the identical React tree. Browser local storage is confined
to the root preference adapter; future authoritative preference/branding reads
belong to Settings, not individual components.

## Application boundary

The root composes `QueryClientProvider`, theme resolution, app shell, and the
Quote/API adapter. React Query owns Quote server state. Draft form values are
local only. The adapter sends cookies with requests and never sends a Principal,
role, capability, or tenant authority. It maps typed server errors, preserves a
stale-draft warning, and offers explicit reload rather than automatic overwrite.

The M1.7 API currently has no Customer/Product lookup, Quote list, or safe
capability disclosure. The proof therefore accepts authoritative IDs and a
known Quote ID; it does not fake those APIs. Price calculation and totals remain
backend facts. An override control is deferred until a safe capability/read
model exists; direct override requests remain server-enforced by M1.7.

The client uses same-origin `/v2` requests with session credentials;
cross-origin API configuration is intentionally excluded until a V2 host has an
explicit CSRF composition. This remains a **PENDING UI SYSTEM VALIDATION**
proof rather than a complete Sales workspace: M1.7 does not yet expose
capability discovery, lookup/list reads, or all controlled line/price-override
operations needed to demonstrate the complete edit model safely. This UI does
not invent those backend contracts.

## Scope deliberately deferred

M1.7.5 provides an app shell, UI Lab, theme resolver, semantic components, and
one Quote workspace. It does not create an Order UI, Billing, Routing, Portal,
Settings persistence, a full Sales workspace, or V1 UI integration. M1.11 owns
the broader shared Sales workspace.
