---
name: printershero-debugging
description: Owner-first debugging for PrintersHero/QuoteVaultPro. Use when reproducing a defect, tracing incorrect prices or lifecycle state, diagnosing stale projections, fixing cross-module workflows, or adding a regression test. Requires root-cause evidence and fixes at the authoritative owner rather than neighboring symptoms.
metadata:
  category: development
  project: QuoteVaultPro
---

# PrintersHero Debugging

Use the repository's single ownership authority:
`docs/architecture/v2/V2_MODULE_OWNERSHIP_BOUNDARIES.md`.
This skill is a procedure, not another ownership map. Use the same content with
any Agent-Skills-compatible agent; no particular agent tool or vendor is required.

## Workflow

REPRODUCE -> TRACE -> IDENTIFY AUTHORITATIVE OWNER -> IDENTIFY ROOT CAUSE ->
SEARCH FOR SAME DEFECT PATTERN -> IMPLEMENT FIX AT OWNER -> ADD/UPDATE REGRESSION
TEST -> RUN OWNERSHIP CHECKS -> RUN RELEVANT VALIDATION -> REPORT EVIDENCE

1. **Reproduce.** Verify branch and `git rev-parse HEAD` against the requested
   target. Capture the smallest failing input, expected result, actual result,
   relevant identities, and environment. Mutating database reproductions require
   a guarded disposable test/clone database, never shared DEV or production.
   Provider side effects require separate explicit authorization and a safe test
   provider target. If reproduction requires shared-data changes, stop and report
   the dependency rather than treating debugging as permission to make them.
2. **Trace.** Follow the request from caller through contract, operation,
   transaction, persistence, and read projection. Distinguish stale presentation,
   cache, or read-model problems from authoritative-state problems. Record which
   component first changes a correct fact into an incorrect one.
3. **Identify authoritative owner.** Read its document section and the relevant
   approved decisions and known debt. Before changing mutation behavior, identify
   both the owning module and transaction boundary. A directory or UI screen is
   not evidence of ownership.
4. **Identify root cause.** Explain the violated invariant and its causal path.
   Separate incorrect stored facts from missing projection refresh, rounding,
   replay/idempotency, authorization, or transaction coordination defects. If
   ownership is unresolved or the apparent fix crosses ownership, stop and
   surface the dependency to the coordinator/human owner with evidence.
5. **Search for the same defect pattern.** Search siblings, callers, adapters,
   and tests for the same erroneous calculation, state transition, query,
   conversion, or stale-read assumption. Record related occurrences and scope;
   do not silently expand the authorized fix into a broad rewrite.
6. **Implement fix at owner.** Preserve its canonical operation, historical
   evidence, and transactional boundaries. Never patch a neighboring symptom
   because it is convenient, duplicate a calculation or transition to make a
   test pass, add UI-only business logic to compensate for an owner defect, or
   bypass an owner operation with direct SQL. Documented debt is not permission
   for new debt. Foreign-domain work must be requested from its owner.
7. **Add/update regression test.** Exercise the failing invariant at the owner's
   boundary. Include relevant edge cases, replay/tenant isolation, and a test
   that the invalid case fails. Do not weaken assertions or manufacture a second
   rule to get a passing reproduction.
8. **Run ownership checks.** Run `npm run v2:boundaries` and
   `npm run v2:ownership`. Confirm any known-debt entry is unchanged or removed,
   never widened. A mechanical pass does not settle unresolved business ownership.
9. **Run relevant validation.** Run `npm run v2:validate` and the applicable
   domain regressions. Consult `printershero-change-verification` and
   `printershero-database-safety` for guarded database/provider tests. A passing
   reproduction alone is insufficient. Required unavailable suites are blockers,
   not implicit passes; report reasons without silently skipping them.
10. **Report evidence.** State exact starting commit, reproduction, trace,
    authoritative owner, root cause, same-pattern search results, files changed,
    regression and validation commands/results, unrun checks, and residual risks.
    DEV validation precedes MAIN; promotion requires explicit human approval.

## Completion Check

- The defect is fixed at the owner, not masked in another layer.
- No business rule, mutable source of truth, or cross-owner SQL path was added.
- Issued/historical evidence remains intact and debt is not expanded.
- Regression coverage extends beyond the original reproduction.
- Validation evidence distinguishes PASS, FAIL, and BLOCKED.
