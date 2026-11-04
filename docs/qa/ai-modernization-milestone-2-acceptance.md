# AI Modernization Milestone 2: capability acceptance

Acceptance date: 2026-11-04. Foundation: `6bf8e3b39ca9785ee40f4b9dbce70b105c4df814`.

**Configured-provider acceptance remains blocked, not passed.** This report
separates actual document/HTTP evidence from injected provider/repository tests.
No permanent Order, customer, product, price, setting, worker or deployment was
modified during acceptance. No new AI subsystem or business parser was added.

## Access and actual-provider boundary

Current DEV history contains Milestone 1. This process has no configured AI or
database credentials, Railway CLI, or existing Railway CLI login. Browser
inventory identifies existing DEV and Railway DEV tabs, but selecting DEV fails
before page access with `Cannot read properties of undefined (reading 'timeoutMs')`.
Two supported selection forms produced the same tooling error. Browser cookies
or credentials were not extracted as a workaround. MAIN tabs were not operated.

Consequently the current tenant's resolved provider/model, image support,
tool-choice quality, reasoning quality, latency and live business lookups remain
unverified. Repository compatibility descriptors are **not** live configuration
or provider acceptance evidence. No model/provider configuration was changed.

## Actual PO 26-109691

The original local PDF was found and read without modification. It is a
single-page, 821,842-byte AcroForm document, not an image-only scan.
SHA256: `dcb735d8603ca60fb075de9ff73d09256aceccd318ba84902ace891df49b5e9d`.
The private document and its rendered images are not committed.

| Requirement | Actual source / extraction evidence | Acceptance limit |
| --- | --- | --- |
| Ordering customer | Offset House is visible in the letterhead; the text extractor does not return the exact spaced company name | No actual provider or live CRM match tested; do not mistake supplier Titan Graphics or the ship-to field for the ordering customer |
| PO number | 26-109691, extracted and visible | Actual-provider interpretation unverified |
| Product | All Sport Hard Hat Stickers — Cut To Shape, extracted and visible | Active PBV2 matching exercised with fixtures, not the live catalog |
| Quantity | 5,300, including the explicit instruction to disregard the older vendor-template quantity | Actual-provider interpretation unverified |
| Finished size | 4 × 1.5 inches, extracted and visible | Canonical pricing remains separate |
| Print/material | 4/0, white vinyl, permanent adhesive | Actual-provider interpretation unverified |
| Finishing | Contour cut and shrink-wrap in 100s | Actual-provider interpretation unverified |
| Pickup | “We will pick up when ready” | Not a shipping destination or delivery commitment |
| Requested deadline | November 10, 2026, end of day | Requested deadline, not automatically an accepted production commitment |
| Customer PO total | $718.25 | Not automatically applied as PBV2 pricing or an override |

The existing optional `OFFSET_PO_REGRESSION_PDF` test was run on this actual
file. It exercises extraction, evidence building, and retention through
refinement using an **injected parsed/provider fixture**. It does not prove that
a configured provider independently extracted those fields. Synthetic form
layouts, ordering-customer versus recipient interpretation, multi-line totals,
draft hydration and price separation have separate fixture checks.

## Demonstrated defects and focused corrections

### 1. Public HTTP reader failed on current Node

An actual request through the existing `web.open` tool to
`https://www.iana.org/help/example-domains` failed with
`Invalid IP address: undefined` on Node v24.20.0. Node requested the
`lookup({all:true})` callback shape, while the pinned resolver returned a single
address string. The callback now returns the appropriate single/array shape,
containing only the already validated address. DNS pinning, private-address and
redirect checks, response limits and private-data egress checks are unchanged.

After correction the same actual HTTP tool returned IANA's **Example Domains**
page with its URL, public unauthenticated classification and retrieval time
`2026-11-04T05:29:53.445Z`. This verifies real public HTTP, under a synthetic local
staff context. It does not verify the deployed tenant or an AI provider's use of
the source. No private PO/customer/price evidence was sent to public research.

### 2. Provider-visible PO image silently lost filled form values

The actual PO's text/form values extracted, but its provider-visible image
contained blank form entries. PDF.js reported unavailable standard-font data and
ignored Helvetica glyph paths. After supplying the same local PDF.js standard
fonts and CMaps already used by the artwork renderer, the original page image
visibly contains the PO number, quantity, size, date, print/material, finishing,
pickup and total. Both before and after renders were inspected.

The local resource-path helper is shared by PDF extraction, Assistant/inbound
visual rendering and the existing artwork renderer. There is no external font
fetch, system-font dependency, document action execution or new OCR/parser.
Pixel tests require genuine non-embedded text to paint rather than accepting any
nonempty PNG as successful interpretation. Existing quarantine, tenant file
resolution, page coverage and ephemeral image-byte protections are retained.

### 3. Search-key dependency hid independent URL inspection

The Assistant's catalog previously omitted both `web.search` and `web.open`
without a public-search key. The existing public URL reader requires no search
subscription. The available-tool projection now retains `web.open` and advertises
`web.search` only when configured. Organization/provider kill switches and
per-call staff/tenant/egress checks remain authoritative. No key, external
service, native provider search or environment setting was activated.

## Task matrix

| Task | Result | Evidence type |
| --- | --- | --- |
| Current configured provider/model | BLOCKED | Browser tool failure and absent local credentials; no provider invocation |
| Actual PO text/form evidence | PASS | Original local PDF, existing extractor |
| Actual PO provider-visible page | PASS after correction | Original local PDF, existing renderer, visual inspection |
| Independent AI extraction of actual PO | BLOCKED | No configured-provider access |
| CRM search/customer lookup | PASS in fixtures only | Existing tenant-scoped canonical read adapters; safe not-found and contact projections |
| PBV2 matching | PASS in fixtures only | Active-version/name/synonym/specification matching and ambiguous-choice protection |
| Pricing comparison | PASS in fixtures only | Existing canonical-pricing adapter fixture: $718.25 PO versus $800 fixture price; mismatch preserved and no override applied |
| Historical Order investigation | PASS in fixtures only | Existing canonical paginated Orders query delegation and tenant-scope protection |
| Public URL research | PASS after correction | Actual IANA HTTP result, source URL and retrieval time |
| Public search subscription/provider reasoning | NOT VERIFIED | No search key or configured AI-provider access |
| Proposal preparation / discovery | PASS in fixtures only | Existing shared adapters, permission-filtered schemas and proposal-only GO flow |

## Preparation coverage and remaining gaps

No missing adapter was needed for the requested CRM/catalog/pricing/history
reads. Existing shared preparation covers the connected Product, Material,
Quote, PO-intake and fulfillment operations; it does not establish complete
staff UI parity. The canonical registry still explicitly identifies
`products.pricing_formula_profile`, `products.delete` and organization-preference
administration as missing/unmigrated Assistant adapters. Advanced PBV2 bypass
administration is deliberately AI-ineligible, not an adapter to expose casually.
No such consequential operation was requested as an acceptance action, so no
speculative writer or new permission was added.

Execution/GO services, exact proposal/version binding, stale-save checks,
canonical Order creation, pricing and evidence reconciliation were not changed.
Live provider behavior while staff edits a real draft remains an acceptance gap.

## Validation and remaining acceptance

Focused automated checks cover the corrected DNS contracts and availability,
public egress/SSRF, PDF font rendering, original-PO evidence preservation,
fixture CRM/catalog/Orders reads, pricing separation and shared proposal
discovery. Scoped TypeScript uses the 8192 MB heap. No persistence contract or
schema changed, so no PostgreSQL suite or migration is required. Fixture runs
use injected repositories and a nonconnecting loopback import placeholder;
they are not PostgreSQL persistence validation. The native canvas test runtime
retains a `CustomGC` handle; focused render test invocations use Jest's explicit
`--forceExit` after assertions complete.

To finish configured-provider acceptance, restore supported authenticated DEV
browser access or supply an authorized DEV execution context; do not paste
credentials into chat. Inspect existing safe AI settings/capability endpoints,
then use an acceptance conversation with the original PO and the existing
document tools. Exercise CRM/PBV2/history reads and a separate non-sensitive
public research task. Do not press GO or mutate operational intake records.
Capture sanitized provider/model, field retention, source coverage and failures.
No provider should be declared accepted from fixture results or descriptors.

This release is DEV code support. No MAIN push, deployment wait or deployed
verification is included. **Deployable but not yet live-validated.**
