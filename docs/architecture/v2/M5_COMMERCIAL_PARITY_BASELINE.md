# M5 Commercial Parity Baseline

## Determination

**COMMERCIAL PARITY BASELINE ESTABLISHED.** This is the first reusable M5
shadow/parity slice, not completion of M5 or authorization for a cutover.

## Safety boundary

| Environment | V1 writes | V2 writes | M5 use |
| --- | --- | --- | --- |
| Existing V1 DEV / production databases | V1 only until domain cutover | Never | Read-only observation only when separately authorized |
| Isolated V2 DEV / disposable clone | None through M5 harness | V2 only | Future clone/rehearsal parity |
| Deterministic test fixture | None | In-memory test adapters only | Current baseline |

There is no V1/V2 dual-write path. The M5 harness has no runtime import or
database writer; it compares fixture observations with a V2 evaluation or
application result. `V2_POSTGRES_INTEGRATION=1` and `TEST_DATABASE_URL` were
not available while establishing this baseline, so no clone mutation or live
V1 observation was attempted.

## Harness

`v2/tests/parity/harness.ts` is deliberately small:

1. Normalize only generated identities, timestamps, audit/outbox/request IDs,
   and explicitly unordered collections.
2. Compare the remaining canonical business projection recursively.
3. Emit `domain`, `fixture`, field path, V1 value, V2 value, and
   `UNCLASSIFIED DRIFT` for any material mismatch.
4. Fail tests on unclassified drift. A known difference must be recorded in
   the matrix below before it is accepted.

It does not remove prices, customers, quantities, dimensions, selections,
lifecycle, invoice values, or routing requirements. The executable fixture
uses the actual V2 pricing evaluator, Quote create/send/accept application,
Quote-to-Order conversion application, Order creation choreography, and the
typed Sales-to-Billing/Routing ports via isolated in-memory transaction
adapters.

Run it with:

```text
npm run v2:m5:commercial-parity
```

## Classification

| Classification | Meaning |
| --- | --- |
| `PARITY` | Material V1 and V2 business results match. |
| `INTENTIONAL_DIFFERENCE` | An approved safer/clearer V2 model differs. |
| `V2_DEFECT` | V2 misses required business behavior. |
| `V1_LEGACY_DEFECT` | Confirmed V1 defect intentionally not reproduced. |
| `SEMANTICALLY_EQUIVALENT` | Different representation, same business meaning. |
| `NOT_COMPARABLE` | Persistence architecture differs; compare invariants instead. |
| `DEFERRED` | Outside this M5 slice. |
| `INSUFFICIENT_EVIDENCE` | Cannot yet be proven safely. |

## Fixture provenance

The pricing values in this first slice are captured legacy-characterization
vectors already preserved by M1 in
`v2/tests/modules/pricingParityAdapter.test.ts` (the tests identify them as
characterized V1 behavior). M5 reuses those expected outcomes rather than
implementing another copy of V1 pricing. The combined `banner-and-yard-sign-
conversion` fixture is a deterministic composition of those captured values:
36x42 banner at 125 cents/sq ft plus a 600-cent pole-pocket option (1,913
cents), and six quantity-only yard signs at 100 cents each with an authorized
525-cent selling override.

Captured fixtures are clearly not live executable V1 comparisons. Clone and
read-only V1 comparisons remain distinct rows below.

## Commercial parity matrix

| Domain / operation | V1 source / fixture | V2 source | Normalization | Class | Material result / risk | Automated coverage | Remaining unknowns |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Customer / Contact selection | Captured commercial fixture | Quote application `validateContactReference` and document reference | IDs only; retain tenant/customer/contact relationship | `PARITY` | Same Customer + Contact selected; P0 tenant risk | M5 combined fixture | Clone cross-tenant record read |
| Product / PBV2 configuration | Captured M1 V1-characterized product vectors | Product compatibility input + V2 pricing evaluator | Generated config/result IDs only | `PARITY` | Quantity-only and dimension product/configuration retained | M5 quantity/banner fixtures | Active/inactive legacy product mapping on clone |
| Quantity-only pricing | M1 captured yard-sign vector | `V2PricingParityAdapter` | None on money | `PARITY` | 6 × 100 = 600 cents | M5 direct fixture | Legacy tier combinations |
| Dimension pricing | M1 captured banner vector | `V2PricingParityAdapter` | None on geometry/money | `PARITY` | 36x42 at 125 cents/sq ft = 1,313 cents | M5 direct fixture | Sheet/roll runtime calculator clone replay |
| Option modifier pricing | M1 captured pole-pocket vector | `V2PricingParityAdapter` | None on selection/money | `PARITY` | +600 cents, total 1,913 cents | M5 direct fixture | Percentage/matrix/tier fixture transfer |
| Minimum, tiers, matrix, rounding | Existing M1 V1-characterized suites | V2 pricing adapter | None on money/rates | `PARITY` | Existing regression vectors remain authoritative | `pricingParityAdapter.test.ts` | Add individual M5 harness rows after V1 clone capture |
| Authorized override | Captured combined fixture | Quote application selling-price decision | Generated decision/timestamp IDs only | `PARITY` | Calculated 600; authorized selling result 525 | M5 combined fixture | V1 role/authority mapping in clone |
| Tax behavior | No safe V1 tax capture in this slice | Billing-owned tax input is passed, not recomputed by Sales | Do not normalize tax | `INSUFFICIENT_EVIDENCE` | No claim of tax-total parity; potential P1 finance risk | Sales-to-Billing typed projection only | Clone fixture with tax evidence/rounding |
| Quote creation and save result | Captured combined fixture | V2 Quote application | IDs/timestamps only | `PARITY` | Customer, products, dimensions, selections, calculated/selling totals retained | M5 combined fixture | Update/edit against legacy persisted Quote |
| Quote lifecycle: Send / Accept | Captured lifecycle expectation | V2 Quote send/accept application | Checkpoint IDs/timestamps only | `PARITY` | `not_sent → sent → accepted` | M5 combined fixture | Legacy ambiguous transition cases |
| Quote → Order | Captured accepted commercial snapshot | V2 conversion + Order application | New Order/line IDs only | `SEMANTICALLY_EQUIVALENT` | Immutable accepted commercial truth copied; V2 additionally enforces atomic/idempotent coordination | M5 combined fixture and M1 conversion rehearsal | Clone conversion data readback |
| Draft Invoice | Captured zero-tax fixture | V2 Sales-to-Billing Draft input | Invoice IDs only; retain lines/subtotal/tax/total | `SEMANTICALLY_EQUIVALENT` | V2 Billing owns exactly one Draft Invoice; fixture preserves 2 lines / 2,438-cent subtotal | M5 combined fixture port projection; M3 billing rehearsal | Billing calculation + non-zero tax clone parity |
| Routing context | Captured routing-required banner | V2 Order-to-Routing typed port | Route instance/step IDs only | `SEMANTICALLY_EQUIVALENT` | One banner line requires one frozen route; quantity-only line requires none | M5 combined fixture | V1 route/status mapping |

## Drift register

No unclassified drift and no V2 defect were found in the deterministic M5
commercial fixture. No V1 defect is being reproduced. The intentionally
different representations are:

| Difference | Classification | Disposition |
| --- | --- | --- |
| V2 uses immutable Quote checkpoints and new Order line IDs on conversion | `SEMANTICALLY_EQUIVALENT` | Preserve V2 atomic/idempotent model; compare commercial truth, not rows. |
| V2 Billing owns a single Draft Invoice rather than copying V1 invoice lifecycle shape | `SEMANTICALLY_EQUIVALENT` | Compare financial content and initial projection only. |
| V2 Routing stores template/frozen instance/steps rather than V1 status representation | `SEMANTICALLY_EQUIVALENT` | Compare required-work context, not route tables. |

## Automated fixture inventory

| Fixture | Covers |
| --- | --- |
| `quantity-only-yard-sign` | Quantity-only product and integer-cent price |
| `dimension-banner-base` | Dimensions and per-square-foot price |
| `dimension-banner-fixed-option` | Option modifier and discrete cents |
| `banner-and-yard-sign-conversion` | Customer/contact, two lines, configuration, authorized override, Quote creation, Send, Accept, conversion, Order preservation, Draft Invoice projection, routing context |
| `normalization-guard` / `material-guard` | Generated-value normalization and field-level drift reporting |

## Unresolved questions and next slice

The following are `INSUFFICIENT_EVIDENCE`, not accepted parity: live V1
read/calculation observations; DEV-shaped clone create/update/conversion;
non-zero tax and tax rounding; V1 active/inactive Customer/Product behavior;
matrix/tier/percentage combination capture; and persisted V1 routing status
mapping.

Next M5 slice: provision an authorized disposable clone, capture read-only V1
commercial records with provenance, replay the same inputs into isolated V2,
and extend this matrix with non-zero tax, matrix/tier, lifecycle rejection,
and durable Invoice/Route readback comparisons. Do not dual-write or mutate
V1 production.
