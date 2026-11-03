# Production equipment and configuration audit

Date: 2026-11-03. Scope: current V1 DEV source and local synthetic validation.

## Evidence boundary

No authenticated tenant equipment export or verified remote database connection
was available in this checkout. Database environment variables and Railway
credentials were not present. Installed equipment, current saved tenant lists,
machine status, and physical specifications have **not** been verified. Source
defaults and seed names are not evidence that a machine is installed or active.
No remote printer, material, production assignment, or MAIN data was changed.

## Existing architecture

| Concern | Existing owner | What it actually represents |
| --- | --- | --- |
| Document printing | `printer_profiles`, `printerProfiles.repo.ts`, `PrinterProfileForm` | Tenant print destinations, paired Windows Print Agent/queue, supported documents, copies/feed/media settings; Travelers, labels, Quick Notes and office documents |
| Production machines | `organizations.settings.preferences.production.printerOptionsByStation` | Station-keyed arrays of machine **names**, without equipment IDs or capability profiles |
| Job machine assignment | `production_jobs.assignedPrinterId/Name/ByUserId/At`, `productionJobs.routes.ts` | Explicit staff assignment and `printer_assigned` history; free-form names remain supported |
| Stations/steps | `production_station_steps`, production map/config services | Active station/managed-step workflow; separate from individual physical equipment |
| Ink Master | `ink_master_printers`, `inkMasterService.ts` | Ink container price/restock settings and saved calculator specs; not a routing equipment inventory |
| Inventory | `materials`, material families and variant values | Material form, width/height/thickness, roll length/waste, stock, purchase/consumption units and optional specs JSON |
| Product/material | `material_product_links`, PBV2 material overrides and inventory consumption, saved line `materialId` | Product associations and selected material identity/consumption; customer selling price stays in PBV2 |

Ink Master source seeds include `Canon M5W` and `Digitech Flatbed`. These do not
verify the production equipment model, configuration, or presence in a tenant.

## Equipment reconciliation

The following are the owner's stated inventory to reconcile against actual
records, not newly created equipment. No manufacturer specifications are assumed.

| Stated equipment | Source evidence / reconciliation needed |
| --- | --- |
| Canon Colorado M5W | Legacy roll suggestion `Canon`; Ink Master seed `Canon M5W`. Confirm whether these refer to this installation. |
| Epson SureColor S60600 | Legacy roll suggestion `S60`. Confirm identity; do not rename automatically. |
| Epson SureColor S40600 | Legacy roll suggestion `S40`. Confirm identity; do not rename automatically. |
| Mimaki UCJV300 | No model-specific production configuration found in source. Live presence unknown. |
| HP Latex 3000 | No model-specific production configuration found in source. Live presence unknown. |
| Digitech ST | Legacy flatbed suggestion `Jetson`; Ink Master seed `Digitech Flatbed`. Their relationship is unverified. |
| Kongsberg XL24 | No structured equipment record/model found in source. Station/step names do not establish machine capabilities. |
| Graphtec FC9000 cutters | No structured equipment record/model or installed quantity found in source. |
| Laminator | No structured equipment record/model or installed quantity found in source. |

For **every** installation, active/inactive status, actual station assignment,
minimum/maximum roll width, printable versus physical width, rigid bed/sheet
limits, thickness allowance, white ink configuration, multilayer modes, supported
print modes/speeds, and finishing restrictions require operator verification.
Do not populate these from model names or another similarly named installation.

## Material compatibility

- Roll and sheet dimensions, thickness/unit, roll waste/length, inventory status,
  families and product links already exist. The Material editor exposes them.
- `specsJson` exists as generic material metadata. No shared typed contract was
  found for machine compatibility, white ink, multilayer modes, lamination, or
  contour-cutting equipment. Arbitrary JSON is not a validated compatibility rule.
- PBV2 selected choices can carry material overrides and consumption entries;
  `shared/pbv2/materialAuthority.ts` preserves the selected material authority.
- Media width is not a machine's maximum printable width. Sheet dimensions do
  not establish bed capacity. Recorded stock is not a promise of available capacity.
- Lamination/finishing option display exists, but a finishing note does not
  identify a compatible finishing device or prove a complete routing plan.

## Current routing trace and gaps

1. PBV2/product and line snapshots establish options, material references, and
   workflow requirements. Product-type default station/step and saved overrides
   feed `productionRoutingResolver.ts` and canonical Order routing services.
2. Design/Proofing/Prepress gates and ownership remain canonical. Prepress can
   select a production destination and prepare final files or Combined Runs.
3. Station jobs resolve machine-name suggestions; staff explicitly assign a
   machine. These lists do not perform physical printer-fit validation.
4. `productionRunService.ts` validates eligible physical lines, allocation,
   station/material conflicts and authorized compatibility override reasons.
   Existing proof, credit, file, lifecycle, and completion checks remain required.
5. Existing station completion rules and Fulfillment services own the next
   handoff. No equipment-aware capacity planner is present in this audited path.

Reliable routing recommendations are blocked by missing stable equipment
identities, verified capability profiles, normalized print requirements, validated
material-to-equipment links, finishing links, speed/capacity calendars, and a
defined unknown/unsupported state. These need a separately reviewed model and
operator acceptance; they are not implemented as a new routing engine here.

## Focused correction delivered

- Settings → Printers now shows a read-only production machine overview alongside
  existing document print profiles. It labels organization-saved choices versus
  legacy defaults, warns about malformed/duplicate lists and legacy station keys,
  and explicitly states that capabilities/status have not been recorded.
- An expandable, internally scrolling material view reads the existing catalog
  on demand, displays recorded dimensions/stock/status, flags missing dimensions
  or impossible roll edge waste, and links to canonical Material editing.
- Shared machine-option normalization now honors explicit configured lists,
  including an empty list. The row picker no longer appends hardcoded defaults
  to a tenant's list. Bulk suggestions use per-job tenant choices and retain
  existing assignment names for manual historical use.
- Server/client use the same legacy suggestions. A missing list keeps the prior
  fallback; free-form manual assignment, current saved assignments and history
  remain intact. No machine is selected, saved, or reassigned by these reads.

No persistence contract, schema/migration, material catalog, product, machine
configuration, job assignment, automatic route or production gate changed.

## Future shared AI read capability

Preserve `canonicalCapabilityRegistry.ts`, `toolRegistry.ts`, the existing
product summary/pricing reads and production reporting adapters. A future narrow,
tenant-scoped read adapter can wrap the existing production config read,
Materials/Product repositories and selected PBV2 snapshots. It should return
record identity, provenance, configuration completeness and explicit unknowns.
Do not make models read raw settings SQL or invent capabilities from aliases.

Before answering “which printer/media/finishing device” or “can these jobs share
a run,” supply verified equipment profiles and call existing fit/run validation
contracts. Unknown limits must remain unknown. AI may prepare recommendations;
canonical permission, exact proposal/version approval, lifecycle and ownership
checks must guard consequential release or rerouting. No new AI tools,
orchestration, eligibility or configuration switches were added in this task.

## Operator decisions and follow-up

1. Export tenant machine lists and reconcile aliases against installed units,
   count, status and station ownership without altering historical assignments.
2. Confirm actual print/media/ink/white/multilayer modes and finishing limits for
   each installation, with a source and verification date.
3. Approve a shared equipment identity/capability model and material/finishing
   link contracts. Avoid repurposing document print profiles or Ink Master.
4. Define printer-fit versus media-fit semantics, approved material combinations,
   override permissions and treatment of missing capability data.
5. Only then implement separately reviewed recommendation reads, capacity
   planning inputs and AI access. Do not activate automatic assignment by default.

## Validation limits

Focused pure configuration tests, frontend tests, scoped TypeScript with 8192 MB
heap, and a local browser fixture cover this correction. Browser API responses
are synthetic. No PostgreSQL writes/persistence contract changed, so database
workflow tests are not required. There was no physical printer test, operator
acceptance, remote inventory verification, DEV/MAIN deployment verification,
or live production routing validation.
