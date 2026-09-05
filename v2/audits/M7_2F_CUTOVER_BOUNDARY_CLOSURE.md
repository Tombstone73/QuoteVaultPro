# M7.2F cutover boundary closure

## Disposition: BLOCKED

The single-service boundary is insufficient as currently evidenced. Stopping the one `PrintersHero-PRODUCTION` Railway replica terminates the V1 API and its in-process workers, including the live asset-preview worker. However, authenticated Railway read-only inventory also found a separate live `prepresshero` production project with an online API service and an online `prepresshero-workers` service.

The worker service has an explicit `./start_worker.sh` command and current logs show active preflight, rendering, and webhook consumers. Its redacted configuration includes `DATABASE_URL`, Supabase service-role/storage, Redis, and Postmark variable names. Read-only OAuth access cannot reveal or fingerprint its database target. It is therefore a genuine independently deployed production-writer candidate until it is proven isolated from PrintersHero PROD or is included in the same maintenance stop/verification boundary.

## Required boundary

```text
maintenance / user ingress closed
  -> PrintersHero V1 Railway replica stopped and observed at zero
  -> prepresshero worker target proven isolated OR service stopped and observed at zero
  -> no other independently deployed PROD writer
  -> final database restore point
  -> guarded reconciliation + normal migration continuation + attestation
  -> V2 starts read-only, then writers and user ingress are released
```

There is no per-order handoff. Existing business records remain in the database and resume under V2 after the schema boundary is proven.

## Machine-verifiable boundary gate

`npm run v2:m7_2f:write-free-gate` validates a fresh sanitized manifest named by `M72F_EVIDENCE_FILE`. It passes only when all seven current authorities are present: maintenance ingress, the Railway V1 runtime, independent production writers, MCP PROD, MCP DEV, V2 PROD runtime, and the reconciliation executor. It rejects stale, duplicate, malformed, unknown, running, open, or mutation-capable observations.

For this environment, `independent-prod-writer` cannot truthfully be marked `not_deployed`: `prepresshero-workers` is running. The future gate may pass only after a read-only target-isolation proof or after the external project is stopped and Railway reports zero replicas. This is the narrow change from the M7.2E broader source inventory; providers are not separate database writers when all application consumers are stopped.

## Prepress decision

The M7.2D graceful-drain correction applies to QuoteVaultPro's standalone prepress entrypoint. The deployed PrintersHero V1 revision predates that correction, but no standalone QuoteVaultPro worker service appears in its Railway project. The separately deployed `prepresshero-workers` service is a different repository/runtime, so M7.2D's correction does not establish its stop behavior. Do not deploy an intermediate V1 merely for the source fix; first resolve the external worker's actual database/provider scope and deterministic stop method.
