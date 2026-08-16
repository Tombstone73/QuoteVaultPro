# M2.0.5 — Artwork UI Integration

## Scope and visual authority

`reference/lovable-ui` remains the visual and interaction reference. Runtime
code is `v2/ui`; it does not import, build, or depend on the reference project.
M2.0.5 wires the approved Order **Artwork** tab to real M2.0 Artwork data while
retaining the shared M2.UI0 shell, Appearance provider, tokens, and six theme
presets. It does not implement Proofing, Prepress, Production, a storage
upload browser adapter, or a parallel Artwork workflow.

## Reconciliation

| Lovable element | Classification | M2.0.5 treatment |
| --- | --- | --- |
| Order Artwork chain and line-item file names | Real Artwork fact | Bounded, tenant-scoped order projection from `ArtworkFile + ArtworkAssignment`. |
| Customer/production/proof/reference classification | Real Artwork usage fact | Render the assignment purpose, with side, source page, and layer identity. One repeated filename is therefore intentional: it is one file with multiple usages. |
| Derived-file indication | Real Artwork lineage fact | Render only when `derivedFromArtworkFileId` is present. |
| Artwork status badges (Approved, Proof Pending, Production Ready) | Future/other-domain projection | Not fabricated. Proofing, Prepress, Production, and Routing retain ownership of their separate facts. |
| `Upload Files` | Missing browser adapter | Not wired. M2.0 accepts a completed storage object only through authenticated adoption against a real OrderLine; no browser staging/upload adapter exists yet. |
| `Send Proof` | Future Proofing action | Not wired. |
| `Open` to the global Artwork workspace | Future workspace navigation | Kept outside this integration; the global page includes unsafe mock workflow controls. |
| Required/missing roles, expected product dimensions, match/mismatch, generated previews | Missing authoritative inputs/renditions | Not fabricated. Product/routing/prepress policy and a rendition pipeline must establish those facts first. |

## Runtime boundary

`GET /v2/organizations/:organizationId/artwork/orders/:orderId` is a single
bounded PostgreSQL projection. It joins Artwork assignments/files under the
organization and Order identity, avoiding tenant-wide file browsing and UI
N+1 queries. It requires `artwork.view` and a freshly issued Permission-Set
Principal.

`POST /v2/organizations/:organizationId/artwork/files/:artworkFileId/assign`
is deliberately narrow: it adds a usage for an existing ArtworkFile with an
M0 `businessRequestId`, CSRF, a fresh Principal, and `artwork.assign`. It does
not upload bytes, make a file “current,” replace history, advance routing, or
start a workflow. The existing M2.0 semantic identity and M0 replay handling
converge duplicate assignment requests.

The Order Artwork panel uses React Query keyed by session scope, organization,
and order. It displays authoritative server state after refresh. The shared
UI bootstrap exposes only the `artwork.view` and `artwork.assign` capability
decisions; it never accepts browser capability or storage claims as authority.

## UI / DOMAIN DECISION REQUIRED

The approved Lovable Artwork chain displays workflow badges such as **Proof
Pending**, **Approved**, and **Production Ready**, plus an `Open` action. These
appear to combine Proofing, Prepress/Production, and navigation concerns;
M2.0 does not own any of those workflow states. Preserving them literally as
Artwork fields would duplicate incorrect state.

Options:

1. Preserve them as read-only projections once the owning Proofing, Prepress,
   Production, and Routing read contracts exist. **Recommended.** This keeps
   the approved visual treatment and one source of workflow truth.
2. Remove/defer badges and action until those contracts exist. This is the
   current safe behavior, but visually leaves the data row less complete.
3. Replace them with real owning-domain actions in a later approved Lovable
   revision. This is only appropriate after the workflow UX is deliberately
   designed.

`Replace Production Art` is also a UI/domain decision: M2.0 intentionally has
no current-selection or historical supersession policy. An assignment removal
or replacement control must wait for a named policy rather than silently
destroying durable history.

## UI PLACEMENT DECISION REQUIRED

No approved placement exists for the M2.0 browser adoption command. The global
Lovable upload button has no real OrderLine context, while M2.0 forbids
ownerless Artwork adoption. Candidate placements are: (1) a line-item action
in the existing Order Artwork row, (2) a line-item inspector reached from the
approved `Open` flow, or (3) a dedicated staged-upload route. **Recommendation:
design a line-item inspector/upload flow in Lovable after a safe storage staging
adapter is selected.**

## Validation evidence

The guarded clone-only authenticated browser suite creates a real Order,
seeds a completed object through the real Artwork application service, then
uses the actual HTTP assignment route. It proves one file receives
customer-supplied/front, production/front, and production/back assignments;
page/layer data persists; identical M0 replay returns one assignment; the
limited Principal is denied before mutation; another tenant receives no access;
Audit/attribution is truthful; refresh retains server state; and frozen route
instances are unchanged. The comparison uses 1440×900 screenshots of the
Lovable Order Artwork tab and the authenticated V2 Order Artwork tab under the
same approved shell/theme family.
