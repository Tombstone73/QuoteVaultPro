# M7.7F Blocked-Path Validation

## AI: PASS (deterministic orchestration)

On DEV deployment `e924dbb`, authenticated M7 QA validation created one canonical synthetic inbound intake. `PREPARE` produced a pending `inbound.mark_duplicate` command without mutation; `CANCEL` marked that command cancelled and left the intake `received`; a new `PREPARE` created a distinct pending command. Literal `GO` transitioned the intake once to `duplicate`. Repeated `GO` returned a conflict and the detail endpoint confirmed the single terminal transition. Foreign-organization AI use returned 403. Hostile text produced no tool command. No external AI provider was called.

The first GO exposed PostgreSQL parameter inference in the canonical inbound transition. Explicit SQL casts repaired it; the original attempt failed closed and made no transition.

## Inbound: PARTIAL PASS

Canonical V2 synthetic ingestion, cancellation/retry-safe AI execution, and terminal duplicate transition are live-validated. V2 route tests cover exact-tenant rejection and malformed timestamps. Full human review, attachment adoption, and Order conversion remain to be exercised against QA fixtures.

## Proof: READY FOR QA VALIDATION

The exact-tenant suppression seam has focused guard coverage. The live Proof v1 → revision → v2 → approval/stale-response matrix has not yet been run; real Gmail delivery remains intentionally unvalidated.

## Portal: READY FOR QA VALIDATION

The exact-tenant, owner/admin, confirmed activation seam has focused guard coverage. The live activation/login and object-scope matrix has not yet been run; production Gmail activation remains unchanged and unvalidated here.

## Lifecycle

No broad already-proven production/fulfillment/finance paths were re-run. Consequently, the complete cross-workflow lifecycle is still pending final QA evidence.
