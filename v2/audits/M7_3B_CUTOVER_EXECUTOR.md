# M7.3B cutover executor contract

## Disposition: defined, not authorized to execute production

M8 uses one ephemeral, operator-run, direct PostgreSQL process. It is not a Railway service, Vercel function, V1/V2 startup hook, CI job, or permanent migration worker. This document defines the handoff; it does not authorize a production connection or SQL.

## Preparation boundary

`npm run v2:m7_3b:production-executor:prepare` is intentionally inert. It requires:

- the fresh, sanitized M7.3A evidence manifest and separately supplied production endpoint fingerprint;
- `M73B_EXECUTOR_MODE=prepare-only` exactly; any execute-like mode fails;
- a unique attributable `m8-cutover-...` run ID;
- an operator approval reference, immutable source revision, controlled-launch reference, and durable log-retention reference.

It imports no PostgreSQL client, never reads a database URL or provider credential, and never invokes migrations. It therefore cannot be used as an unattended production executor. It prints only the run ID and immutable source revision; inputs and logs must be sanitized references, never URLs or credentials.

## M8 operator procedure

1. An assigned release commander starts an ephemeral controlled operator shell from the approved immutable source revision. The shell receives only the direct database credential through the approved ephemeral secret channel; it is not added to tracked files, Railway, Vercel, shell history, or evidence.
2. The release commander independently supplies the non-secret approved production endpoint fingerprint and runs the M7.3B preparation command. This re-runs the M7.3A gate, so stale, target-mismatched, incomplete, or secret-bearing evidence fails before any connection attempt.
3. Only after an explicit M8 execution authorization can a separately reviewed direct reconciliation runner receive the transient credential. Before stage SQL it must recompute the endpoint fingerprint, prove the expected database identity, create/re-read the reconciliation ledger, and acquire the transaction-pinned `m7_reconciliation_lock` row with `FOR UPDATE NOWAIT`.
4. The runner keeps that lock connection open until it has closed all work connections. It records its immutable source digest and the same run ID in the reconciliation attempt ledger. Lock contention, missing ledger, target mismatch, or lost lock is terminal and requires a new operator decision; there is no wait, steal, or automatic retry path.
5. The runner performs the existing staged R0264--R0269 postcondition checks, then the normal-Drizzle gate. It writes only the already-designed reconciliation and migration records. It performs no provider, Vercel, Railway, MCP, storage, or application-runtime actions.
6. On exit (success or failure), it closes direct connections, clears the transient credential from the controlled runtime, retains sanitized command/ledger evidence under the stated retention reference, and terminates the ephemeral shell. It does not restart V1 or release V2 writers.

## Ownership and auditability

The release commander owns launch approval; the database runner owns the durable lock only while its database transaction is alive; and the designated audit custodian owns retained, sanitized logs. A later production runner must be reviewed as a separate M8-authorized artifact. M7.3B intentionally does not implement it, preserving the clone-only refusal in `runM72CReconciliation.ts`.

## Required completion evidence

The future cutover record must retain sanitized references to the successful M7.3A manifest, independent endpoint fingerprint, operator approval, immutable executor revision, run ID, durable lock/attempt ledger state, stage postcondition digests, normal-Drizzle gate result, and connection cleanup confirmation. It must not retain database URLs, usernames, passwords, API keys, session tokens, or raw business records.
