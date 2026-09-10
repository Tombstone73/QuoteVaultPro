# M7.8A current V1 → V2 operational parity matrix

## Scope and provenance

This is a source-and-contract parity audit, not a production cutover or a claim
that historical V1 records have been migrated. The V1 reference examined was
local `main` at `29b99eb8ad7b94257c09e6a08e3413801b810679`; `origin/main`
resolved separately to `1326ad1b1bda70e478adc44b3b7ee3ccdf7e5102`. V2 was
examined on `dev` at `87b04ff64c6020699da799f16aabe32f83f386a1` before this
milestone's closure changes. The differing V1 refs are recorded rather than
silently treated as one runtime provenance.

`PARITY` means an operator can reach the capability using canonical V2
authority. `SUPERSEDES` means V2 deliberately preserves the operational intent
with a safer immutable/scoped model. `PARTIAL` and `GAP` require the associated
P1 decision before cutover; they are not represented as completed capability.

| Operational surface | V1 reference behavior | V2 current behavior | Status | Priority / evidence |
| --- | --- | --- | --- | --- |
| Customers and contacts | customer/account list, detail, contact maintenance | tenant-scoped cursor-paged Customer/Contact workspaces, primary-contact authority, activity hub | SUPERSEDES | P1: credit/terms/internal account fields are not yet V2 commercial authority |
| Customer commercial policy | staff account/product conventions | capability-gated Customer portal-entitlement and active pricing-agreement authoring, server-enforced Sales pricing | PARITY | P0 closed in M7.8A; policy is audited and ProductVersions remain immutable |
| Products | create, edit, publish catalog offerings | New Product Draft → typed Builder → immutable publish flow, material/routing/pricing controls | SUPERSEDES | New Product was already present at baseline; stale test/audit assertion corrected |
| Quotes | create, configure, price, send, accept, convert | canonical sales quote authority, current pricing, conversion and documents | PARITY | P1: clone/revise/void and quote-attachment ergonomics need a business decision |
| Orders | create/edit, workflow/routing, traveler | canonical Order projection, frozen route evidence, direct/no-production policy, Traveler | SUPERSEDES | P1: duplicate/reorder/line-note/header fulfillment ergonomics |
| Artwork | source attachments and operator preview/download | canonical Artwork assignment, immutable source/derived lineage and proof/prepress ownership | SUPERSEDES | P1: generic private-file preview/download remains incomplete outside owned workflows |
| Proofing | issue/review/revision | immutable versions, exact artifact viewer, scoped staff/portal response | SUPERSEDES | P1: bulk operational output/delivery live validation |
| Prepress | work queue and handoff | readiness blockers, production-art revision, atomic frozen-destination handoff | SUPERSEDES | P1: batching/nesting/exception-run ergonomics |
| Flatbed and Roll | station-specific workboards | common canonical attempts/quantity authority with station presentation, artwork, material and Traveler context | SUPERSEDES | P1: machine/printer/waste/pause/reopen operational controls |
| Fulfillment | shipment/pickup records | immutable quantity handoffs, partial/multiple events, manual shipment metadata and combined compatible shipments | SUPERSEDES | P1: prepared-shipment recovery/detail and combined-container document scope |
| Invoices, payments and refunds | billing records and payment operations | order-backed Invoice, immutable Payment/Refund allocation facts, Stripe/QuickBooks boundaries | SUPERSEDES | Invoice issuance was P0-unreachable and is closed in M7.8A; provider/live validation remains P1 |
| Customer portal | account/order/quote/invoice/proof access | authenticated customer-scoped reads, entitled catalog, canonical Orders, proof/fulfillment reads and allocation-aware payments | SUPERSEDES | P1: remaining document/profile/configuration live validation |
| Inbound Orders | email-led intake/review/conversion | durable V2 intake, deterministic review, canonical Customer/Product/Order conversion | SUPERSEDES | P1: authorized Gmail read adapter and provider validation |
| CRM activity, shell and navigation | broad sidebar/top-bar search | scoped activity hub, capability-filtered completed modules and action center | PARTIAL | P1: global search/notification authority deliberately absent |
| Inventory/procurement | V1 material/procurement support | canonical material/consumption/reservation foundation | PARTIAL | P1: full purchasing/inventory operator surface needs a separately bounded milestone |
| Integrations and workers | live V1 provider authority | V2 boundaries and QA-safe adapters | GAP | P1: production OAuth/webhook/worker topology validation belongs to approved cutover control-plane work |
| AI assistant | V1 assistant behaviors | capability-bounded audited PREPARE/GO/CANCEL command plane | SUPERSEDES | P1: external-provider validation remains intentionally deferred |

## M7.8A P0 closure

1. **New Product** is not a current gap: the baseline already had the canonical
   `POST /v2/organizations/:organizationId/products` command and New Product
   Draft Builder route. The current visual contract proves its reachable entry.
2. **Issue Invoice** is now a capability-gated Finance action for a current V2
   draft Invoice. It invokes only canonical `invoiceApi.issue`; it cannot issue
   legacy or already-issued records.
3. **Customer commercial authoring** is now reachable from Customer detail for
   staff with both Product Edit and Pricing Configure. It reads current
   entitlements/active agreements and invokes only the server-owned commercial
   policy endpoints. It does not calculate, override, or mutate price in React.

## Explicit non-claims

- No V1 provider, production runtime, production database, MAIN, or cutover
  control was modified.
- No undocumented V1 feature is treated as a V2 requirement merely because it
  existed historically.
- P1 rows remain open until implemented or explicitly waived by the business
  owner with the operational consequence documented.
