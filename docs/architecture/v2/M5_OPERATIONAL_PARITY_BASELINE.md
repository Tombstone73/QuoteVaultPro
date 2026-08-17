# M5 Operational Parity Baseline

## Determination

**OPERATIONAL PARITY BASELINE ESTABLISHED.** This is the operational M5
baseline after the commercial baseline; M5 remains one Shadow/parity milestone
and is not closed or authorized for cutover.

## Safety and evidence model

V1 remains the sole writer of existing V1 DEV and production databases. V2
writes only through isolated test/clone environments. This baseline adds no
V1/V2 dual write, production mutation, V1 edit, database migration, or runtime
parity path. `TEST_DATABASE_URL` and `V2_POSTGRES_INTEGRATION=1` are not
available, so no clone or live-V1 observation was run.

The shared `v2/tests/parity/harness.ts` remains the only M5 comparator. It now
also permits a reviewed material drift to retain its field-level evidence while
being classified (for example, an approved intentional difference); it never
normalizes material drift away. `DOMAIN_DECISION_REQUIRED` is added to the
shared classification vocabulary for later M5 slices.

## Fixture inventory

| Fixture | V2 execution / evidence | Covers |
| --- | --- | --- |
| `canonical-file-typed-usages` | M2 Artwork identity/assignment contracts | One file, customer/proof/production usages, front/back/page/layer, derived lineage |
| `revision-and-approval-history` | M2 Proofing contracts | Issuance, revision request, approval, immutable versions, exact art, no Prepress/Route side effect |
| `front-back-exact-coverage` | Frozen production-requirement resolver and Prepress state helper | Required units, exact front/back evidence, missing-unit completion block |
| `next-up-partial-reprint` | V2 Production application with isolated transaction adapter | Next up, Flatbed first start, partial output, completion, Roll reprint, immutable attempts, exact art |
| `first-production-attempt-race` | V2 Production application with isolated transaction adapter | One winning initial attempt in the fixture transaction |
| `mixed-handoffs-and-produced-context` | V2 Fulfillment application with isolated transaction adapter | Repeated pickup/shipment, mixed handoffs, independent lines, overage rejection, Produced < Fulfillment |
| `approved-art-to-handoff` | Cross-domain semantic projection | Exact art through proof/prepress/production to customer handoff |

## Operational parity matrix

| Area | V1 evidence | V2 source | Classification | Material comparison / disposition | Remaining evidence |
| --- | --- | --- | --- | --- | --- |
| Artwork ownership and canonical file identity | Captured operational intent fixture | Artwork file plus typed assignments | `SEMANTICALLY_EQUIVALENT` | One canonical file is reused for customer, proof, and production usages; front/back/page/layer remain material. Separate V1 file tables are not reproduced. | Read-only V1 assignment/file lineage capture |
| Artwork derivation and exact downstream file | Captured operational intent fixture | Durable `derivedFromArtworkFileId` and production assignment | `SEMANTICALLY_EQUIVALENT` | Derived file keeps lineage and exact selected production file. | V1 modification lineage capture |
| Proof issue, revision, approval and version history | Captured operational intent fixture | ProofWork + immutable ProofVersions + responses | `PARITY` | Two-version revision/approval history and exact artwork evidence preserved; approval does not mutate Prepress or Routing. | V1 proof-history/read-only workflow capture |
| Prepress required units and exact coverage | Captured operational intent fixture | Frozen requirement resolver + Prepress units | `SEMANTICALLY_EQUIVALENT` | Front/back requirements are derived from frozen commercial truth, not mere art existence; Back missing keeps completion ineligible. | V1 readiness rule capture |
| Production Next up and first station | Captured operator outcome | ProductionWork + first immutable attempt | `SEMANTICALLY_EQUIVALENT` | Untouched work is Next up; first start selects Flatbed or Roll without pre-assignment. | Clone first-start and V1 queue observation |
| Production partial output, completion, reprint, art evidence | Captured operational intent fixture | Production application and immutable attempts | `SEMANTICALLY_EQUIVALENT` | Flatbed initial produces 40, completes, Roll reprint produces 60; exact artwork remains tied to work. | Clone persisted attempt/readback comparison |
| First-start concurrency | No comparable V1 observation yet | Existing M2 clone rehearsal plus isolated fixture race | `INSUFFICIENT_EVIDENCE` | Isolated transaction fixture permits one initial attempt. Production database lock/concurrency proof cannot be rerun without clone gate. | Authorized clone run and V1 concurrent behavior observation |
| Fulfillment partial/repeated/mixed handoff | Captured operational intent fixture | Immutable handoff ledger | `PARITY` | Pickup 20 + 30 and shipment 25 + 25 complete a 100-unit line; a second line remains independently partial; one extra unit is rejected. | V1 handoff ledger read-only capture |
| Produced < Fulfillment authority | No verified V1 observation of a produced/readiness cap | Fulfillment application | `INSUFFICIENT_EVIDENCE` | Ordered 100, prior handoff 20, produced context 40, requested shipment 50 is accepted because remaining ordered authority is 80. V2 behavior is required by M2/M3 architecture. | V1 legacy outcome; if it caps at produced quantity, record an `INTENTIONAL_DIFFERENCE` rather than weaken V2 |
| Cross-domain chain | Captured operational intent fixture | Canonical operational projections | `SEMANTICALLY_EQUIVALENT` | One OrderLine retains exact art, required units, proof version, production attempts, and legitimate final handoff. | Clone durable chain replay |

## Results and drift register

Operational baseline classifications: 2 `PARITY`, 5 `SEMANTICALLY_EQUIVALENT`,
0 `INTENTIONAL_DIFFERENCE`, 0 `V2_DEFECT`, 0 `V1_LEGACY_DEFECT`, 0
`NOT_COMPARABLE`, 0 `DEFERRED`, 2 `INSUFFICIENT_EVIDENCE`, and 0
`DOMAIN_DECISION_REQUIRED`.

No unclassified drift was accepted and no V2 defect was found. The only
material unresolved candidate is the historical V1 produced/readiness cap. It
is explicitly retained as an evidence gap, not asserted as a V1 behavior.

## Fulfillment authority result

V2 authority remains:

```text
ordered quantity - completed legitimate handoffs
```

The required Produced < Fulfillment fixture passed: ordered 100, produced
context 40, prior completed handoff 20, requested shipment 50. V2 accepted the
handoff and left 30 remaining. Production output was not an authorization
input. Over-fulfillment beyond remaining ordered quantity was rejected.

## Risks and next slice

The commercial tax `INSUFFICIENT_EVIDENCE` item remains unrelated and open;
operational work did not force a resolution. Outstanding risks are read-only V1
operational records, clone persistence/concurrency evidence, non-zero tax,
V1 proof/prepress coupling, V1 routing/status mappings, and carrier/provider
transport (deferred outside Fulfillment handoff).

Next M5 slice: run an authorized disposable clone comparison with captured
V1 read-only artwork/proof/prepress/production/fulfillment records. Add
durable first-start concurrency, exact persisted attempt/hand-off history, and
the observed V1 produced-quantity policy to this matrix. Do not dual-write or
mutate V1 production.
