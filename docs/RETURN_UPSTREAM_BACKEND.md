# Return Upstream backend contract

V1, backend only. No migration or new persisted workflow status.

## Command

`POST /api/line-items/:lineItemId/return-upstream`

Authenticated internal staff with the current organization's Owner/Admin membership only.
The service independently checks membership; the request cannot supply tenant or actor identity.

```json
{
  "destination": "design",
  "reason": "Artwork needs correction before production",
  "expectedWorkflowState": "in_prepress",
  "expectedOwnerJobId": "current-prepress-job-id",
  "expectedUpdatedAt": "2026-09-30T12:00:00.000Z"
}
```

Destinations: `design`, `proofing`. Origins: `ready_for_prepress`, `in_prepress`.
Reason: trimmed, required, maximum 2,000 characters. The timestamp is the canonical
line-item `updatedAt`; all three expected-state values must match under lock.
Unknown request fields are rejected.

Success returns `{ success: true, data }`, where data contains line/order identity,
destination, canonical workflow transition, prior proof identities/statuses,
retired approval identity, superseded IDs, resumed proof identity, and any proof-sync result.
Consumers must refresh canonical data after success and after stale-state conflicts.

Validation returns 400; missing/cross-tenant work returns 404; unauthorized roles return 403.
Domain conflicts return 409 with a message and code, including `UPSTREAM_STALE_STATE`,
`UPSTREAM_INVALID_ORIGIN`, `UPSTREAM_PRODUCTION_CONFLICT`, `UPSTREAM_ACTIVE_RUN`,
`UPSTREAM_FULFILLMENT_BOUNDARY`, `UPSTREAM_SHARED_PROOF`, and `UPSTREAM_PROOF_BYPASS`.
Serialization/deadlock conflicts return 409 and require refresh/retry; there is no partial commit.

## Lifecycle

Return to Design supersedes actionable draft/sent versions and clears the current
approval pointer. Approved versions and approval records retain their original status,
actor, timestamps and decisions. Design becomes `needs_design` using canonical ownership.
No prior proof means no invented proof or approval record.

On subsequent Design completion, the existing proof synchronizer creates the first or
next numbered draft if proofing is required and artwork is available. Historical versions
without current authority cannot satisfy the same-file reuse check. Without artwork,
the required proof workflow remains blocked until artwork becomes available. A line that
does not require proofing follows its normal route without creating a proof.

Return to Proofing activates `awaiting_proof_approval`, retaining canonical Prepress
ownership. An existing individual draft/sent version resumes without duplicate creation.
With no actionable version, synchronization creates a first/successor draft when artwork
exists. A historical approval alone never satisfies the new current requirement.

## Safety and history

- Line locks serialize workflow changes, proof generation/send/response/recovery and
  production run creation. Customer responses reread proof status after taking the lock.
- Direct physical station routing also enforces Design completion and the canonical
  current-proof gate; it cannot bypass retired authority. Normal explicit Order proof
  bypass behavior is unchanged. Return Upstream rejects conflicting bypasses beforehand.
- An active combined proof is rejected for this single-line operation. Resolve the
  combined proof first; this endpoint does not invalidate other lines' customer decisions.
- Active downstream ownership/runs are rejected. No production cancellation occurs.
- The canonical fulfillment projection rejects physically fulfilled or administratively
  resolved work. Replacements/rework remain separate operations.
- Active Prepress sessions are retired with the existing `complete` terminal value.
  The return audit distinguishes upstream retirement from a forward production handoff.
- Canonical station uniqueness may reuse a previous terminal Design job row. Complete
  prior work snapshots are appended to the return audit before reuse; previous events
  and Design session history remain untouched.
- Audit captures actor, organization, order/line, source/destination, reason, expected
  state, previous jobs/proofs, retired sessions, and successor/resumed identities in
  the same transaction. Manual approval cannot revive a version retired by this command.

No frontend controls, arbitrary-stage API, fulfillment reversal, or schema changes.
Database concurrency and deployed behavior require separate live validation.
