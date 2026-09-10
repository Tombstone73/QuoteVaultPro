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

## Detailed normalized operator matrix

The table below is the continuation audit. Rows are normalized business
capabilities (rather than every individual component control); source paths are
the current V1 `main` and current V2 `dev` paths stated above. `Mounted` means
the V2 shell or an owning V2 workspace exposes the action to an authorized
operator; every listed V2 command also has a scoped server contract.

| Area | Legitimate V1 operator capability and evidence | V2 UI / authority / persistence evidence | Class | Launch action |
| --- | --- | --- | --- | --- |
| CRM | Browse/search Customers: `pages/customers.tsx`, `CustomerList.tsx` | Sales → Customers, `CustomerWorkspace.tsx`, scoped `customerRoutes.ts` | PARITY | — |
| CRM | Create/edit Customer plus billing/shipping address | Customer workspace POST/PATCH under `customer.edit` | PARITY | — |
| CRM | Add contact and choose primary contact | Customer detail controls; contact/customer command routes | PARITY | — |
| CRM | Contact list/edit/activate-deactivate | Sales → Contacts, `ContactsWorkspace.tsx` and scoped contacts routes | PARTIAL | P1 list filtering/sorting/page and standalone creation decision |
| CRM | Standalone lead/contact, contact address/mobile/flags/billing recipient | V1 `pages/contacts.tsx`, contact form/detail | MISSING | P1; becomes P0 only if billing/invoice delivery currently depends on it |
| CRM | Customer notes, credit limit/balance, terms, tax/type/pricing tier | V1 customer detail, credit and relations routes | MISSING | P1 commercial-account decision; do not recreate mutable tier pricing blindly |
| CRM | Customer activity and related records | bounded tenant-scoped V2 Activity hub links to owning contexts | SUPERSEDES | historical compatibility/read policy still needs cutover evidence |
| CRM | Merge/export/import | V1 merge/export has backend evidence but no current operator UI proof | NOT REQUIRED / UNPROVEN | validate real usage before making it a gap |
| CRM | Destructive customer/contact delete | V1 destructive control | V2 archival/audit preservation | SUPERSEDES | do not restore except for a legal-erasure requirement |
| Products | Catalog, keyword search, page, product detail | Products sidebar → `ProductWorkspace.tsx`, Product HTTP workspace reads | PARITY | — |
| Products | Create Product | V1 Products Add form | New Product Draft Builder → typed initial-Draft command → publish | SUPERSEDES | P0 closed; current visual contract verifies reachability |
| Products | General configuration, options, measurement modes | Draft Builder and typed Draft General/Options commands | SUPERSEDES | — |
| Products | pricing, matrices, formulae, options, area/quantity pricing | Builder plus server preview and ProductVersion pricing contracts | SUPERSEDES | — |
| Products | material recipe and routing | typed recipe; routing-owned templates and frozen Order route evidence | SUPERSEDES | — |
| Products | publish/history | immutable ProductVersion Draft/Publish flow | SUPERSEDES | — |
| Products | duplicate, deactivate/archive | V1 product controls | no equivalent V2 control found | PARTIAL | P1 routine catalog administration |
| Quotes | list, create, customer/contact, PO/due/notes, line configuration | Quotes workspace / Sales entry / quote application services | PARITY | — |
| Quotes | authorized price override | V1 override UI | capability-gated `quote.overridePrice`, canonical pricing evidence | PARITY | — |
| Quotes | send, accept, convert | V2 mounted controls with quote send/convert authority | SUPERSEDES | immutable conversion evidence retained |
| Quotes | duplicate; staff revise/void semantics | V1 quote editor controls | no matching V2 control found | PARTIAL | P1 duplicate; owner decision for exact revise/void semantics |
| Quotes | attachments/artwork and Quote PDF/print | V1 Quote attachment/PDF panels | no Quote-scoped V2 artwork/PDF path substantiated | MISSING | P1; promote if source art/PDF is required before quote acceptance |
| Quotes | configurable saved list columns/sort/filter/export/gallery | V1 `internal-quotes.tsx` preferences/export | V2 keyword/lifecycle/cursor list only | PARTIAL | P1 operator efficiency; owner decides required columns/export |
| Orders | list/search/status/pagination | Sales → Orders server-backed workboard | PARITY | — |
| Orders | create/edit header, customer/contact, PO/due/terms | Sales entry and Order application | PARITY | — |
| Orders | line configuration, dimensions, quantity, removal, price override | Order workspace and canonical Sales commands | PARITY | — |
| Orders | frozen product route and Direct Production / no-production | Product workflow intent, canonical work projection | SUPERSEDES | no free-text reroute restoration |
| Orders | per-line notes, duplicate line, persisted line reorder | V1 line dialog / `OrderLineItemsSection.tsx` | no V2 note/duplicate/reorder command found | MISSING | P1 notes/duplicate; reorder requires owner decision unless sequence is contractual |
| Orders | ship/pickup/delivery intent, destination and instructions | V1 `OrderFulfillmentPanel.tsx` | no order-header V2 equivalence substantiated | PARTIAL | P1; validate whether Fulfillment owns the canonical substitute |
| Orders | source artwork upload/typed assignment | V1 artwork panels | Order → Artwork workspace → canonical upload/assignment routes | SUPERSEDES | — |
| Orders | artwork thumbnail, private viewer/download, replace/revision controls | V1 preview/download/zip panels | V2 Artwork workspace now invokes the existing tenant-scoped `artwork.view` content route for private browser preview, open, and download; canonical replacement/lineage remains Artwork-owned | PARTIAL | P1 only for any additional revision ergonomics, not private file access |
| Orders | whole-order duplicate | No current V1 UI proof after source re-check | no V2 claim | NOT REQUIRED / UNPROVEN | do not add a speculative gap |
| Documents | Quote/Order/Invoice PDF browser preview/print | V2 owned document routes and Quote/Order/Finance actions | PARITY | Quote PDF evidence remains conditional on current mounted Sales document route validation |
| Documents | Traveler / production ticket | V1 ticket/Traveler controls | canonical frozen-work Traveler PDF from Production stations | SUPERSEDES | — |
| Documents | printer-profile/thermal options | V1 printer settings and ticket options | V2 browser PDF only; Production Connections is Future | PARTIAL | P1 only if shop needs profile-directed print |
| Artwork/Proof | proof queue, prepare, issue, recipient/retry | Proofing workspace and capability-gated proof routes | SUPERSEDES | — |
| Artwork/Proof | immutable proof version, customer response, exact artifact/history | V2 exact-version private artifact + response routes | SUPERSEDES | — |
| Artwork/Proof | combined/bulk proof output | V1 combined selection bar | no V2 bulk selection found | PARTIAL | P1 if batch proofing is routine; otherwise waive |
| Prepress | queue, open/start/complete; production-art replace; readiness | Prepress workspace, scoped prepress/artwork routes | SUPERSEDES | — |
| Prepress | frozen-destination safe Production handoff | V2 ready-only handoff service | SUPERSEDES | — |
| Prepress | advanced status/station/rush filters and bulk/nesting/runs | V1 prepress board controls | V2 lacks equivalent batch/run domain | PARTIAL | P1 at production scale; owner decides batch model |
| Prepress | material override / original-files ZIP / standalone preflight | V1 prepress controls | no safe V2 equivalent found | PARTIAL | owner decision; do not bypass inventory/artwork authority |
| Production | Flatbed/Roll navigation, queues, start/output/complete | V2 shell stations, attempts, quantity commands | SUPERSEDES | — |
| Production | front/back/double-sided, material grouping, frozen art | Roll/Flatbed panels and work projections | SUPERSEDES | — |
| Production | partial good quantity/no overproduction/history | V2 attempt and output evidence | SUPERSEDES | — |
| Production | pause/hold/reopen/return-to-prepress, notes and waste | V1 production recovery/note controls | no V2 immutable exception workflow found | PARTIAL | P1 routine exception handling |
| Production | machine/printer assignment, bulk reassign, capacity calendar | V1 boards/actions | V2 intentionally has no scheduling domain | DEFERRED WITH DECISION | implement only a canonical scheduling authority if required |
| Fulfillment | partial/multiple pickup with history | V2 immutable handoffs, pickup controls | SUPERSEDES | — |
| Fulfillment | shipment quantities, carrier/service/tracking/notes/package count | Shipment Builder and container endpoints | PARITY | — |
| Fulfillment | compatible combined shipment | V2 bounded allocation selection and server compatibility transaction | SUPERSEDES | — |
| Fulfillment | packing slip/pickup receipt | private per-handoff allocation document path | SUPERSEDES | decide only whether a single combined-container manifest is required |
| Fulfillment | reopen prepared/existing shipment, correction/void/reversal | V1 shipment detail/recovery | no V2 recovery/correction UI found | MISSING | P1 routine dispatch safety |
| Fulfillment | multi-page dispatch filters and combined selection | V1 fulfillment filters | V2 bounded loaded set only | PARTIAL | P1 at dispatch volume |
| Invoices | server-paged A/R list, search/filter/sort, Invoice PDF | Finance workspace and invoice routes | PARITY | — |
| Invoices | issue an order-backed draft | V1 finalize action | Finance `Issue Invoice` with `invoice.issue`, CSRF and canonical Billing service | PARITY | P0 closed in this milestone |
| Finance | manual payment, Stripe confirmation, allocations, refund ledger | Finance workspace/Billing transaction | SUPERSEDES | — |
| Finance | reminder configuration and payment receipt/export | V1 admin/finance controls | no V2 operator setting/action substantiated | DEFERRED WITH DECISION | collections requirement determines P1/P2 |
| QuickBooks | connect/readiness, approval, queued sync/retry/reconcile/import | QuickBooks settings console and scoped queue services | SUPERSEDES | live OAuth/company mapping remains a validation item |
| Settings | team, permission sets, portal access | Users & Permissions, capability assignment services | SUPERSEDES | role-template DEV proof still required |
| Settings | organization, documents, tax, numbering | mounted scoped settings workspaces | PARITY | V1 invoice/PO numbering mapping needs owner confirmation |
| Settings | email/Gmail connection | V2 settings connect/adopt/disconnect boundary | PARTIAL | live provider read scope/templates/rules remain P1 |
| Settings | notifications, preferences, shipping/carriers | V1 settings pages | V2 explicitly labels these Future | MISSING | owner must waive or set bounded launch requirement |
| Shell | capability-filtered navigation and Command Center | `VisualShell.tsx`, bootstrap capability snapshot, scoped APIs | SUPERSEDES | — |
| Shell | Ctrl/Cmd+K global search | V1 Titan topbar/global search | no deterministic V2 shell search | MISSING | P1 efficiency; promote only if dispatch depends on it |
| Shell | breadcrumbs/back guard, customer/contact list columns/preferences | V1 shell/list settings | local entity back controls; limited V2 saved sales sort state | PARTIAL | P2 except for proven daily high-volume lists |
| Shell | theme/contrast/density/sidebar | V1 appearance | V2 Appearance workspace and shell toggle | SUPERSEDES | — |
| Portal/Inbound/AI | V2 launch-added portal, inbound, customer pricing, flexible routing, immutable proofs, multi-event fulfillment, aggregate payment, safe AI | mounted V2-specific domains and prior QA evidence | V2-ONLY REQUIRED | retain; V1 parity must not regress these capabilities |
