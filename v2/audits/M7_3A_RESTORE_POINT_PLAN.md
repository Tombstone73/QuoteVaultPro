# M7.3A final restore-point plan

## Disposition: BLOCKED for provider verification

The preferred final restore point is an explicit Neon snapshot of the verified active PrintersHero production root branch. A disposable child branch is useful for rehearsal but is not the final rollback point because it has a different connection endpoint and switch workflow.

## Preconditions and safe identity

The release commander must first prove maintenance ingress closed, the sole V1 Railway service at zero replicas, and the active-work evidence manifest captured. Then, using authorized Neon Console/API access, list the project and branches and verify that the active root branch carries the approved non-secret production endpoint fingerprint. The prior production fingerprint is retained only in the M7 audit record; no URL or credential belongs in this plan.

## Exact M8 procedure

1. In Neon, create a snapshot of the verified active production root branch, named `m8-pre-reconcile-<UTC>`.
2. Poll the provider operation to terminal success.
3. Record a sanitized evidence item containing project/branch/snapshot identifiers or hashes, source endpoint fingerprint, UTC creation time, actor, terminal state, and stated retention/expiry.
4. Re-read snapshot and branch metadata to verify the snapshot is attached to the intended root branch and is restorable.
5. Store only the sanitized evidence item in the M7 cutover evidence manifest. The actual snapshot is a provider write at an explicitly authorized M8 cutover, not an M7.3A action.

## Zone-A recovery

Before V2 authoritative writes, stop V2 if it has started and restore the verified snapshot to the explicitly verified active root branch with the provider's finalize/activation operation. Poll restoration to terminal success, re-read active-root metadata because restoration can change the branch identity while preserving the active endpoint, and retain the old/orphan branch until the assigned cleanup owner has approved its deletion.

If snapshots are unavailable, the fallback is Neon Restore/Time Travel at a provider-confirmed timestamp/LSN inside the available restore window. Record the selected timestamp/LSN, root-branch identity, retention horizon, restore operation ID, and reconnection verification before performing the restore.

## Missing provider evidence

This environment has no Neon control-plane tool, CLI, token, project/branch metadata, snapshot list, retention window, or restoration-owner record. Consequently it cannot verify the actual root branch, snapshot availability, snapshot retention/TTL, or restore authority. An authorized Neon owner must perform the read-only metadata verification above before M8; that is a P0 prerequisite.

Relevant provider references: [Neon database versioning](https://neon.com/docs/ai/ai-database-versioning), [Neon Backup & Restore announcement](https://neon.com/docs/changelog/2025-10-31), and [Neon Restore / Time Travel Assist](https://neon.com/docs/changelog/2024-02-23).
