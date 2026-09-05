# M7.2D Cutover Authority Plan

## Status: source design complete; live authority proof blocked

`v2/src/modules/cutover/cutoverWriterAssertion.ts` is a pure, fail-closed contract for an operator-collected manifest. It passes only if every expected writer authority is present, has no remaining mutation ability, and has no unknown admission/process/drain state. It is not a process controller and cannot substitute for infrastructure proof.

## Maintenance entry and single schema writer

1. Freeze public mutation ingress: staff, portal/token, assistant execution, provider mutation routes, webhook application, and MCP/automation must reject or durably hold work.
2. Disable automatic V1 migration startup and deployment/predeploy work; confirm no migration advisory lock holder exists.
3. Stop worker/scheduler processes. `WORKERS_ENABLED=false` is necessary only for supported in-process workers; standalone prepress needs its own signal/drain acknowledgement.
4. Capture the per-authority, per-record handoff manifest and run the write-free assertion. Any active/unknown claim is `MUST_SNAPSHOT` or `MUST_RECONCILE_AFTER_START`, never a blind retry/reset.
5. Grant the direct R0264--R0269 executor the sole schema-writer authority. Run attestation, then normal Drizzle.

## Future V2 controlled start

| Order | Preconditions | Process | Success signal | Failure/rollback |
| --- | --- | --- | --- | --- |
| 1 | reconciliation + R0269 attested | V2 read-only backend | health/readiness plus read-only smoke | keep all writers off; investigate |
| 2 | manifest accepted | lifecycle/operational workers | bounded queue/claim ownership proof | stop; retain manifest |
| 3 | operations stable | delivery and provider workers | idempotency/provider-state checks | stop; reconcile uncertain operations |
| 4 | external ingress ownership proven | webhooks, customer mutations | gate probe passes | close ingress and return read-only |

## V1 start-back

Before V2 accepts authoritative writes, V1 may restart only after compatibility smoke checks against the reconciled schema and after restoring the same manifest controls. Failed reconciliation is a forward-fix or restore decision based on the reconciliation ledger; it is never an automatic restart into a partial stage. After V2 accepts authoritative writes, V1 restart requires an explicit forward-reconciliation decision.

## Live blockers

Fresh clone failure/lock evidence, actual process inventory, MCP mutation authority, ingress maintenance enforcement, and provider hold/replay policy are not available from source alone. M7 remains NO-GO.
