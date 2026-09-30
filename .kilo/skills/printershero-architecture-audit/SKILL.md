---
name: printershero-architecture-audit
description: Ownership and boundary audit workflow for the PrintersHero/QuoteVaultPro repository. This skill should be used when auditing who owns a business concept (Customers, Quotes, Orders, Pricing, Products, Production, Proofing, Prepress, Fulfillment, Shipping, Replacements, Billing, Payments, QuickBooks, Auth/Permissions, Portal, Inventory/Materials, Artwork, Routing) across both the legacy V1 code (server/, client/, shared/) and the V2 modular code (v2/), before changing behavior that crosses a module boundary.
metadata:
  category: development
  project: QuoteVaultPro
  status: draft
  verified-against: origin/dev @ 63f19bd39a5c9c799aae3f5335709d346077c96a
---

# PrintersHero Architecture Audit

Procedure for finding which module owns a business concept and whether code respects that ownership.
It produces evidence. It never refactors and never decides ownership.

## Step 0 — confirm you are auditing the intended commit (mandatory, first)

An earlier audit ran against an obsolete branch (`v2/reconstruction`, 70 migrations and 429 commits behind
`origin/dev`) and produced confident, wrong conclusions. Before reading any code:

```
git rev-parse --abbrev-ref HEAD
git rev-parse HEAD                     # must equal the commit you were asked to audit
git rev-list --left-right --count origin/dev...HEAD
```

and read the highest migration tag from `server/db/migrations_v2/meta/_journal.json`. If HEAD is not the
requested commit, **stop and report**. State the audited SHA in every output.

## The single authoritative ownership model

`docs/architecture/v2/V2_MODULE_OWNERSHIP_BOUNDARIES.md` is the **only** ownership authority. Read the
target module's section (Purpose / Authoritative facts / Must not own / Important boundaries / Open
questions) before judging any code. This skill states no owners of its own, and audit reports are
non-authoritative evidence that must never become a second constitution.

**Check the document's age against the code.** Documents drift. Compare the document's module and
decision sections with the directories that exist under `v2/src/modules` and `v2/infrastructure`, and check
the revision note at the top of the document. (Historically the document lagged the code by about 70
migrations and did not describe replacement obligations, shipment containers, shipping pricing, cutover,
portal, inbound, AI, accounting, communications, or documents; it was then reconciled, and now records
approved decisions, *Known boundary debt*, and *Business decisions required*. Re-check rather than assume.)
Where code has a module the document does not describe, that is a **class B** finding (document needs
updating), not evidence of a violation.

**Known boundary debt is not an exception.** The document lists confirmed places where code writes state
another owner owns. A finding that matches a listed item is *already recorded debt*: cite its BD identifier,
do not report it as new, and do not treat it as permitted. A cross-owner write that is **not** listed is new
and must be reported. Business decisions marked BDR are deliberately unresolved: surface them, never resolve them.

Rule from the document (quote it, do not paraphrase): *"Each mutable business fact has one authoritative
owner. Other modules may hold an identity reference, request behavior through a named operation/contract,
or consume an exposed result/event. They must not retain competing mutable truth, directly mutate a foreign
persistence model, reproduce a foreign business rule, or reach through a boundary to another module's
repository."* And: *"A cached projection, explicit reference, immutable checkpoint, or recomputable rendering
is not competing ownership when its source and freshness semantics are explicit."* And the transaction
policy: *"the coordinator calls each module's named operation/port; it does not write foreign tables,
reuse foreign repositories, or duplicate foreign rules."*

## Interaction classification (apply before calling anything a violation)

| Interaction | Class | Report as |
| --- | --- | --- |
| `SELECT`/`JOIN` on another module's tables | acceptable read | not a violation; check the module's "May reference/consume" list |
| `SELECT … FOR UPDATE [OF x]` with no write to x | lock-only coordination | not a violation; note lock-scope coupling |
| Calling the owner's exported function inside one transaction | transaction coordination through the owner | not a violation |
| Copy into an **immutable** snapshot or checkpoint | immutable snapshot | not a violation |
| Read model or projection with stated source and freshness | projection | not a violation |
| Table owned by module A that physically lives in a legacy table (e.g. V1 `customers` for Customers) | module writing its **own** state to a legacy home | not a violation; note as V1 coexistence |
| `INSERT`/`UPDATE`/`DELETE` on a table another module owns, bypassing the owner's function | **foreign mutation** | violation |
| Two mutable stores for one fact with no reconciliation | **duplicate mutable authority** | violation |
| Domain file importing another module's persistence types | contract-hygiene defect | observation, not an ownership violation |

"Physical home" needs care: if the authoritative document assigns a fact to module A, a V2 write by module A
to a V1 table is a **V2→V1 write** to report, but not automatically a violation. Decide by whether A owns it.

## Mechanical measurements (run these; do not audit by reading alone)

Narrative reading missed a real violation once and invented several that did not exist. Enumerate first.

1. **SQL write targets** — extract `INSERT INTO | UPDATE | DELETE FROM` targets from `v2/infrastructure/**`,
   `v2/src/**`, `v2/scripts/**`. Discard regex noise (`set`, `of`, `on`, `skip`, `nowait`, prose). Split by zone:
   `infrastructure` and `src` are production code; `scripts` are rehearsals and reconciliation on disposable clones.
   Read every hit outside `v2_` in full.
2. **Writer directories per table** — group tables by the set of `v2/infrastructure/<dir>` directories that
   write them. Ignore shared platform tables (`v2_audit_events`, `v2_operation_requests`, `v2_outbox_messages`,
   `v2_principal_attributions`). Read every table with more than one writer directory.
3. **Cross-module imports** — resolve every import under `v2/src/modules/<a>/**` that lands in
   `v2/src/modules/<b>/**` (`b` not `shared`); record whether the target is `contracts.ts` or an application file.
4. **Layering** — imports of `pg`/`drizzle-orm`/`@neondatabase/serverless`, `infrastructure/`, or `server/`
   from `v2/src/modules`, `v2/src/application`, `v2/src/authorization`, and `v2/src/interfaces`.
5. **Infrastructure-to-infrastructure imports across directories** — for example
   `infrastructure/fulfillment/*` importing `../sales/*` or `../billing/*`. The boundary script does not police these.
6. **V1 bridges** — the whitelisted `server/**` imports in `check-import-boundaries.mjs`; for each, read which
   V1 functions V2 imports and whether the **imported function bodies** write V1 tables. A bridge that imports a
   provider client is different from one that imports a legacy importer.
7. **Coverage** — run `npm run v2:boundaries`, `npm run v2:ownership`, and the
   architecture negative fixtures through `npm run v2:validate`. Inspect the
   current ownership map, reviewed contracts/bridges, and exact debt baseline.
   Baselines preserve known violations, not permission. Unknown targets or new
   occurrences must be surfaced; do not regenerate a baseline to accept them.
   List its rules and bridges; count tests
   that feed it violating input (behavioral negative tests), separately from tests that only assert its source text.
8. **Test reachability** — which test files are referenced by no `package.json` script and match no runner.

Useful cautions: `UPDATE x SET …` captures `x` correctly but `SET` on its own line captures `set`; `FOR UPDATE OF a,b`
captures `of`; `ON CONFLICT` captures `on`. A large single-line adapter can hold several statements; read the line.

## Ambiguity classes

| Class | Meaning |
| --- | --- |
| **A** | already answered by the authoritative document |
| **B** | partially answered, or the document is silent/stale for code that now exists |
| **C** | truly unresolved and needs an owner decision |
| **D** | implementation missing or misplaced, but ownership is already clear |

Most first-pass "ambiguities" are A or D. Do not present them as open questions.

## Duplication classes

accidental duplicate mutable authority · intentional immutable snapshot · intentional projection or read model ·
compatibility bridge during V1/V2 coexistence · unresolved architectural duplication.

## Report format (per domain)

```
## <Domain>
- Audited commit:
- Authoritative owner (document section):
- Code location:
- State owned (tables) and writer directories:
- Public contract:
- Observed cross-module interactions, each classified:
- Findings: Violation | Duplication | Observation | none
- Ambiguity class: A | B | C | D | none
- Evidence: file:line
```

## Stop conditions

Do not change code, decide class-C ownership, or write a rule into any instruction file. Surface the
question with current behavior, documented intent, owner options, consequences, and whether it blocks the
work in progress. Evidence goes in `docs/architecture/audits/` and is labelled non-authoritative.
