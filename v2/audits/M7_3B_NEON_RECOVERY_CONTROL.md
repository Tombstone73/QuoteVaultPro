# M7.3B Neon recovery control

## Disposition: BLOCKED by absent Neon control-plane access

No Neon control-plane MCP tool, CLI, token, project metadata, branch metadata, restore-window metadata, or snapshot permission is available in this environment. Prior PostgreSQL data-plane access cannot prove provider project identity, root-branch status, branch topology, retention, snapshot availability, or restore authority. No production connection, branch, snapshot, restore, or provider mutation was attempted.

## Actual supported mechanism to verify

Current Neon documentation describes snapshots created from a root branch and provider operation polling. A future release commander must use authenticated read-only control-plane inspection to first verify the actual project, root branch, parent/root status, endpoint fingerprint, configured restore window, snapshot capability, expiration/retention, and assigned restoration authority for this production project.

Only after that proof and explicit M8 authorization may the operator create a named final snapshot from the verified root branch. Capture sanitized hashes/references for the project, root branch, snapshot, create operation, actor, source endpoint fingerprint, cut point, terminal create state, and retention/expiry. The M7.3B evidence gate requires those facts; it no longer accepts a generic restore-point assertion.

## Restore procedure

For a Zone-A failure, stop V2, re-identify the then-active root branch, request restore of the verified snapshot to that branch with the provider's finalization/activation option, and poll the returned operation to terminal success. A finalized restore can preserve the endpoint/connection string while changing the active branch ID and leaving the prior branch orphaned. Re-list/re-fingerprint the resulting active branch before reconnection, and retain the orphan until recovery validation and the designated cleanup decision.

If the project does not expose snapshots, use only the provider-supported PITR/restore mechanism verified for that project; record the selected timestamp or LSN, restore-window/retention evidence, target root branch, provider operation, and terminal state. Do not substitute a child branch for a final rollback point.

Provider references: [Neon database versioning](https://neon.com/docs/ai/ai-database-versioning) and [Neon project management](https://neon.com/docs/manage/projects).

## Minimum unblock

An authorized Neon owner must provide authenticated read-only control-plane access sufficient to list project/branch/endpoint/snapshot/restore-window metadata and caller permissions. A final snapshot remains a provider write reserved for the explicit M8 cutover authorization.
