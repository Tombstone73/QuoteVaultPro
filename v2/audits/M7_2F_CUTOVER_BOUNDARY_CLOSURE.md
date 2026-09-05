# M7.2F cutover boundary closure

## Disposition: PASS WITH FINDINGS

The current PrintersHero V1 writer boundary is one Railway service and one replica. Authenticated Railway read-only inventory found no PrintersHero cron service or separately deployed PrintersHero worker. Stopping that service terminates the V1 API and its in-process writers, including the live asset-preview worker.

The separately named `prepresshero` Railway project is a standalone application outside PrintersHero / TitanOS. It is not a PrintersHero writer, stop requirement, startup dependency, migration dependency, or cutover blocker. This report intentionally does not draw any further conclusion about that application's runtime or configuration.

## Required boundary

```text
maintenance / user ingress closed
  -> PrintersHero V1 Railway replica stopped and observed at zero
  -> no other PrintersHero deployed writer in the authenticated topology
  -> final database restore point
  -> guarded reconciliation + normal migration continuation + attestation
  -> V2 starts read-only, then writers and user ingress are released
```

There is no per-order handoff. Existing business records remain in the database and resume under V2 after the schema boundary is proven.

## Machine-verifiable boundary gate

`npm run v2:m7_2f:write-free-gate` validates a fresh sanitized manifest named by `M72F_EVIDENCE_FILE`. It passes only when all six current PrintersHero authorities are present: maintenance ingress, the Railway V1 runtime, MCP PROD, MCP DEV, V2 PROD runtime, and the reconciliation executor. It rejects stale, duplicate, malformed, unknown, running, open, or mutation-capable observations.

Providers do not independently mutate PrintersHero database state when their Railway application consumer is stopped. This is the narrow actual-topology contract; it does not itself close the maintenance-ingress, restore-point, reconciliation-attestation, or V2-readiness gates.

## Prepress decision

The M7.2D graceful-drain correction applies to QuoteVaultPro's standalone prepress entrypoint. No such standalone worker service or cron appears in the authenticated PrintersHero Railway topology. The deployed V1 revision predates that source correction, so the cutover runbook must still capture active-work state and observe the single service at zero before the database boundary; do not deploy an intermediate V1 merely for the source fix.
