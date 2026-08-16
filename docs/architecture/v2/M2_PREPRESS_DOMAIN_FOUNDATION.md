# M2.2 — Prepress Domain Foundation

## Ownership

Prepress owns preparation execution for an independently addressable production-art unit. It does **not** own an Artwork file, an OrderLine commercial state, a Proof decision, a Route Instance position, or Production execution.

`ArtworkFile` remains the single durable file identity. `ArtworkAssignment` remains the durable OrderLine usage. A Prepress unit only snapshots the precise `production` assignment that it prepares; it never creates a PrepressFile, ProductionArtFile, or PreparedFile table.

## Unit of work

`PrepressUnit` is the smallest durable Prepress identity. It has exactly one tenant-scoped production Artwork assignment and snapshots that assignment's file and orthogonal `side`, source-page, layer key, and layer order evidence. Thus two assignments of the same file may legitimately become two independent units:

```
OrderLine
  ArtworkFile A + production/front/page 0/ink -> PrepressUnit Front
  ArtworkFile A + production/back/page 1/ink  -> PrepressUnit Back
```

The units have separate starts and completions. Completing Front neither completes Back nor changes an Order or OrderLine state. A parent work/container was intentionally not added: it would add aggregate status without owning a business fact.

The lifecycle is deliberately timestamp-based rather than a second workflow enum:

- no `started_at`, no `completed_at`: available after Routing makes the assignment eligible;
- `started_at`: in progress;
- `completed_at`: completed immutable evidence.

There is no generic delete or reopen operation. A completed result remains history. A correction creates derived Artwork through Artwork, a new production assignment, and then a distinct Prepress unit. A future correction/supersession policy can add a typed relation without rewriting completed evidence.

## Entry, Proofing, and Routing

Opening a unit requires all of the following from authoritative owners:

1. a real Sales OrderLine (Quote lines cannot qualify);
2. an explicit Artwork assignment with `purpose = production` for that exact line;
3. a frozen Route Instance for that line whose **current Routing-owned step** is `prepress`.

Prepress does not persist `proofApproved`, a route status, `released_to_prepress`, or `production_ready`. When Routing has made `prepress` current, it is the authoritative composition point for any preceding Proofing prerequisite. A route whose current step is `proofing` cannot open Prepress even if a caller attempts it; Routing must later expose an explicit typed advance operation. A prepress-first route has no artificial Proofing requirement.

M2.2 completion does not mutate Routing. This is intentional because Routing does not yet expose the required unit-aware transition operation. Future composition is:

```
PrepressUnit completed (one explicit production assignment)
  + Product/PBV2 required-unit specification
  + Routing's frozen step/current policy
  -> Routing-owned aggregate step completion decision
  -> Production-owned eligibility/execution for the completed unit
```

That preserves partial progression: Production can later consume Front completion while Back remains in Prepress when the future Routing/Production policy permits it. The coarse route step must not be completed on the first unit; its eventual completion must be calculated from required units, not current uploads.

## Required production units

M2.2.1 closes this gap. Products/PBV2 now resolves a typed production-unit specification from configured selections, and Sales freezes it with Quote/Order line evidence. Prepress consumes the bounded coverage projection; it still never infers requirements from present Artwork. See [M2_REQUIRED_PRODUCTION_UNIT_SPECIFICATION.md](M2_REQUIRED_PRODUCTION_UNIT_SPECIFICATION.md).

## Production-Art selection and history

M2.0 intentionally has no mutable “current production art” pointer. M2.2 preserves that decision. Prepress prepares the explicit production assignment it was opened against. If revised production art is created, Artwork records a new durable file and lineage, then a distinct production assignment. The corresponding Prepress result retains the old assignment/file snapshot. Selection/supersession policy remains a future Artwork/Product requirement and is not silently invented in Prepress.

## Persistence and physical integrity

Migration `0201_v2_prepress_domain_foundation` creates `v2_prepress_units` with:

- composite tenant-safe FKs to Order subtype, OrderLine, and Artwork assignment/file;
- a unique `(organization_id, artwork_assignment_id)` identity, preventing duplicate units for the same selected production usage while allowing Front and Back assignments of one file;
- checks for side/page/layer semantics and complete Principal attribution tuples;
- a PostgreSQL trigger that verifies one same-tenant production Artwork assignment matches every OrderLine/file/side/page/layer snapshot field;
- immutable evidence and start facts; completed evidence cannot be altered or deleted;
- restrictive parent references so Artwork/Order history is not silently destroyed.

Raw SQL is used only in that trigger because PostgreSQL FKs cannot prove both assignment purpose and the cross-table snapshot equality.

## Transactions, authority, and Audit

The application service follows M0 caller-owned transactions and exactly-once reservations for open, start, and complete operations. Business request IDs are never Prepress identities. Concurrent opens converge through the physical unique identity; duplicate completion replays converge through M0 coordination.

Permission Sets add only `prepress.view`, `prepress.work`, and `prepress.complete`. Operations require a fresh tenant-scoped Principal and use the existing AuthorityPolicy. Each successful mutation records M0 attribution and a shared Audit event (`prepress_unit_opened`, `prepress_unit_started`, or `prepress_unit_completed`).

## Lovable reconciliation and deferred UI work

The reference `reference/lovable-ui/src/lib/mock/prepress.ts` correctly illustrates independently released roles, but its `sides`, destination, status, material, proof strings, and `releasedRoles` are mock composition rather than persistence authority.

| Lovable concept | Correct owner in V2 |
| --- | --- |
| artwork viewer / Front / Back / page / layer | Artwork assignment projection |
| proof status | Proofing + Routing projection |
| Ready for Prepress / Waiting on Proof | Routing/Proofing-derived queue projection |
| Needs Production Art / missing role | future Product/PBV2 requirement projection + Artwork |
| production destination / plan | future Production |
| Material | Product/Inventory read projection |
| completed preparation of an exact art unit | PrepressUnit |
| Production Ready | future Routing/Production projection, not a Prepress field |

No Prepress UI was wired in M2.2. M2.2.5 should integrate the approved screen only after the required-unit source has been decided. If the visual design needs to display missing required roles, the needed projection requires **UI PLACEMENT DECISION REQUIRED** only if the approved Lovable layout has no truthful existing location; M2.2 makes no layout change.

## Validation evidence

The guarded disposable PostgreSQL rehearsal applied all V2 migrations through 0201 and passed 30 assertions covering schema postconditions, cross-tenant/Quote/non-production rejection, snapshot semantics, Front/Back/layer/page independence, current-route eligibility, M0 replay/concurrency, completed-history immutability, audit/attribution, rollback, permission denial, and frozen Routing stability. No DEV, MAIN, or production system was accessed.
