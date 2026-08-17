# M5 Shadow/Parity Closure

## 1. Scope and decision

**M5 COMPLETE / READY FOR DEV VALIDATION.**

M5 reconciles the completed commercial, operational, and financial shadow/parity baselines. It establishes deterministic, semantic V2 evidence; it does not authorize M6 domain cutover, dual writes, production mutation, or deployment in this change. V1 remains the only writer of existing V1 DEV and production data.

The master plan's next delivery milestone is M6 domain cutovers, but its entry criteria remain separate. The immediate next action is isolated V2 DEV deployment and live DEV validation; M6 must not begin from this document.

## 2. Baseline results

| Baseline | Result | Primary evidence |
| --- | --- | --- |
| Commercial | Established | Captured pricing vectors and Quote → Order → Draft Invoice/Routing execution through V2 applications. |
| Operational | Established | Typed Artwork, Proof, Prepress, Production, Fulfillment, and operational-chain fixtures through V2 applications. |
| Financial | Established | Exact-cent, append-only Payment/Refund settlement fixture through `BillingPaymentsApplicationService`. |

The financial baseline is intentionally explicit that **COMMERCIAL TAX EVIDENCE STILL INSUFFICIENT**. The closure does not turn that evidence gap into either parity or a V2 defect.

## 3. Combined classification register

| Classification | Commercial | Operational | Financial | Combined | Closure disposition |
| --- | ---: | ---: | ---: | ---: | --- |
| `PARITY` | 9 | 2 | 0 | 11 | Accepted deterministic/captured business result. |
| `SEMANTICALLY_EQUIVALENT` | 3 | 5 | 5 | 13 | V2 representation differs while required business outcome is retained. |
| `INTENTIONAL_DIFFERENCE` | 0 | 0 | 0 | 0 | None recorded. |
| `V2_DEFECT` | 0 | 0 | 0 | 0 | None found. |
| `V1_LEGACY_DEFECT` | 0 | 0 | 0 | 0 | None asserted. |
| `NOT_COMPARABLE` | 0 | 0 | 1 | 1 | Provider recovery persistence shape; compare durable outcome/evidence, not row shape. |
| `DEFERRED` | 0 | 0 | 0 | 0 | None in the three baseline registers. |
| `INSUFFICIENT_EVIDENCE` | 1 | 2 | 2 | 5 | Bounded evidence debt carried to DEV/clone work. |
| `DOMAIN_DECISION_REQUIRED` | 0 | 0 | 0 | 0 | None. |
| Unclassified material drift | 0 | 0 | 0 | 0 | Closure requirement met. |

## 4. Approved V1/V2 representation differences

| Difference | Classification | Preserved outcome |
| --- | --- | --- |
| Quote checkpoint / new Order-line identity | `SEMANTICALLY_EQUIVALENT` | Accepted commercial truth is frozen and converted exactly once. |
| Billing-owned single Draft Invoice | `SEMANTICALLY_EQUIVALENT` | Sales passes commercial/tax context; Billing owns document math and lifecycle. |
| Frozen Routing instance/steps | `SEMANTICALLY_EQUIVALENT` | Required work is retained without reusing legacy status rows. |
| Canonical Artwork, immutable ProofVersions, frozen Prepress units, and immutable ProductionAttempts | `SEMANTICALLY_EQUIVALENT` | Exact art, approval, coverage, production, and handoff truth are retained. |
| Append-only Payment/Refund facts and derived settlement | `SEMANTICALLY_EQUIVALENT` | Exact money owed, collected, refunded, retained, and balance are retained. |
| Provider reconciliation record | `NOT_COMPARABLE` | V2 preserves uncertainty and provider evidence, materializing one immutable financial fact only after confirmation. |

## 5. Critical invariant results

| Invariant | Result |
| --- | --- |
| Pricing and integer-cent selling results | Captured quantity, dimension, option, and override vectors pass with no money normalization. |
| Quote → Order and exactly-once conversion | Accepted checkpoint is required; V2 conversion does not recalculate pricing and is replay-safe. |
| Tax-context preservation | Accepted Quote terms preserve `taxContextReference` into the Order-to-Billing Draft input. Tax calculation/rate/rounding parity remains insufficient evidence. |
| Artwork / Proof / Prepress | One canonical Artwork identity, immutable ProofVersions, and exact frozen required-unit coverage pass. |
| Production | Next-up selection, first-start isolation race, partial output, reprint, and immutable attempts pass. |
| Fulfillment authority | Ordered quantity minus legitimate completed handoffs is enforced; production output is not an authorization cap. |
| Invoice lifecycle | Draft/Issued document state is separate from derived settlement; issued money remains exact cents. |
| Payments / Refunds | Immutable facts, explicit refund allocation, retry/idempotency, overpayment, and over-refund boundaries pass. |
| Provider recovery | Begin is an uncertain operation, confirmation materializes one fact, and replay does not duplicate it. |

## 6. Remaining evidence and risk

| Evidence gap | Classification | Risk and DEV/clone follow-up |
| --- | --- | --- |
| Commercial tax calculation, rate, and rounding from a real V1 source | `INSUFFICIENT_EVIDENCE` | Potential P1 financial risk. Capture safe, authoritative non-zero-tax V1/clone evidence; compare context, calculator evidence, components, rounding, and exact cents. Do not manufacture V1 expected values. |
| Live V1 operational observations and persisted first-start/concurrency behavior | `INSUFFICIENT_EVIDENCE` | V2 behavior is exercised in isolated fixtures, but real V1 workflow/history observations are incomplete. Obtain read-only evidence or authorized clone observations. |
| V1 tenant/authority and financial persistence behavior | `INSUFFICIENT_EVIDENCE` | V2 rejects wrong-tenant/unauthorized operations before ledger mutation. Capture legacy mapping/readback separately. |
| Provider persistence architecture | `NOT_COMPARABLE` | Compare recovery outcome and evidence rather than provider table/row layout. |

These gaps are bounded and registered. There is no known one-cent drift, tenant leakage, duplicate fact, unexplained pricing result, invalid workflow transition, or unclassified material business-state divergence. They therefore do not block the DEV validation boundary.

## 7. Validation completed

| Validation | Result |
| --- | --- |
| Static validation | `git diff --check`, `npm run v2:check`, `npm run v2:ui:check`, and `npm run v2:boundaries` pass. |
| Automated commercial parity | `npm run v2:m5:commercial-parity` passes (5 tests), including tax-context preservation from Quote through Billing input. |
| Automated operational parity | `npm run v2:m5:operational-parity` passes (7 tests). |
| Automated financial parity | `npm run v2:m5:financial-parity` passes (4 tests). |
| Focused V2 regression | Order, Quote-conversion, commercial-persistence, billing-lifecycle, and UI route/appearance regressions pass. |
| UI validation | UI type check, focused UI regression suite, and production build pass. |

## 8. Validation deliberately not completed

| Validation | Status |
| --- | --- |
| Clone validation | Not performed: authorized clone variables are unavailable. |
| Browser validation | Not performed. |
| Visual validation | Not performed. |
| DEV validation | Not performed. |
| MAIN validation | Not performed. |

No missing validation above is represented as having been completed, and DEV validation will provide V2 runtime evidence only; it does not itself prove V1 parity.

## 9. DEV validation objectives (planning only)

After isolated V2 DEV deployment, validate:

1. Application boot, V2 database/API connectivity, staff session/login, organization choice, typed authority, and CSRF behavior.
2. Direct URL load, refresh, SPA history fallback, and browser back/forward on workspace and nested routes.
3. Customer/Product → Quote → Order → Invoice/Routing → Artwork → Proofing → Prepress → Production → Fulfillment → Payment/Refund as a staff workflow.
4. Exact cents, Invoice issue boundary, payment/refund idempotency and allocations, and provider reconciliation recovery using safe DEV fixtures.
5. Non-zero tax behavior with real V2 calculator evidence and a separately authorized legacy/clone comparison when available.
6. Lovable-converged primary workspaces, appearance themes, responsive layout, and absence of major visual regressions.

## 10. Deployment boundary

**NOT DEPLOYED.** No V1 mutation, V1/V2 dual write, clone write, DEV deployment, browser exercise, visual review, or MAIN validation occurred in this M5 closure.

## 11. Closure conclusion

M5 has no V2 defect or unexplained material drift in the combined register. The known tax and legacy-observation evidence debt is explicit, bounded, and suitable for the next isolated V2 DEV validation milestone. M6 domain cutover does not start here.

**NEXT ACTION: DEPLOY V2 TO DEV AND PERFORM LIVE DEV VALIDATION.**
