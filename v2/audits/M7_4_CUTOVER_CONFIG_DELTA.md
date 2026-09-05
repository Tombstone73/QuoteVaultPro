# M7.4 cutover configuration delta

| Change | Classification | Required action |
| --- | --- | --- |
| V2 deployment target guard | **P0 — change before M8** | Replace the DEV-only `requireV2DeploymentDatabaseUrl` authorization with a separately reviewed, production-specific allowlist that pins the approved production endpoint and cannot accept DEV/unknown targets. Current code categorically permits only `PrintersHero-DEV / Development`. |
| V2 frontend API/callback routing | **P0 — change before M8** | Create/verify production routing rather than copying `v2/ui/vercel.json`, which is explicitly DEV-only and targets `api-dev.printershero.com`. |
| Vercel maintenance ownership | **P0 — authorization required** | Complete M7.3B production project/domain/deployment/alias proof before manipulating `www`. |
| Neon root recovery proof | **P0 — authorization required** | Complete M7.3B root branch, snapshot/PITR, retention and restore-authority proof before final restore point. |
| V2 initial workers | **Change during cutover** | Start with invoice/proof delivery flags false and QuickBooks owner non-queue/disabled. Do not infer safety from legacy `WORKERS_ENABLED`. |
| V1 application restart safety | **Change before maintenance/restart** | Freeze deploys and set/verify `DRIZZLE_AUTO_MIGRATE=0`, `WORKERS_ENABLED=false`, and required per-worker controls. Zero replicas is still the actual stop proof. |
| Stripe live account/webhook | **Human authorization required** | Verify live keys/account/Connect state and authorize V2 webhook endpoint/signing-secret transition. |
| QuickBooks production OAuth | **Human authorization required** | Verify explicit production mode, live realm, redirect, token/key continuity; do not start queue until approved. |
| Gmail canonical sender | **Human authorization/configuration required** | Verify `v2_email_integrations` readiness or explicitly adopt/re-authorize; prove production redirect and sender. |
| Supabase artwork storage | **Configuration required** | Read-only validate production project/bucket/privacy/policy/service-role access and V2 prefix before artwork writes. |
| MCP/local bridge | **Not required** | No current V2 writer authority or storage dependency. |

No item in this table is authorized for execution by M7.4.
