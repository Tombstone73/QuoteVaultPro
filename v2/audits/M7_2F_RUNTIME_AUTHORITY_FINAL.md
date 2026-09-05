# M7.2F final runtime authority

| Authority | Current read-only evidence | Cutover classification |
| --- | --- | --- |
| PrintersHero V1 API and in-process workers | One Railway service, one live replica, no cron. Live logs confirm asset-preview runs in this process. | **STOP WITH RAILWAY** |
| QuoteVaultPro standalone prepress entrypoint | Exists in source, but no separate service or cron appears in the authenticated PrintersHero project. Deployed V1 revision predates M7.2D drain behavior. | **NOT CURRENTLY DEPLOYED; capture active-work state before the V1 stop** |
| MCP PROD/DEV | Tracked application contracts disable MCP and no deployed bridge/tool/auth/DB target exists. Current supplied context confirms future-only integration. | **NO CURRENT WRITE AUTHORITY — FUTURE INTEGRATION** |
| Local file bridge | Optional shop-side copier has no DB/Supabase/S3/provider credentials; its only state mutation is via Railway V1 routes. | **NO INDEPENDENT PROD DB WRITE AUTHORITY — FUTURE/OPTIONAL** |
| Stripe, QuickBooks, Gmail | Provider operations and local DB application occur through Railway-hosted code. No independent PrintersHero callback/worker was found in the authenticated topology. | **STOP WITH RAILWAY** |
| Vercel | Connected access exposes development only; no production project/routing/maintenance control was proven. It is not a database writer. | **OPERATIONAL INGRESS GATE — P1** |
| V2 PROD runtime | No V2 production service was found in the PrintersHero project. | **MUST REMAIN ABSENT UNTIL ATTESTED** |
| Reconciliation executor | Direct, durable-lock guarded database process. | **SINGLE EXECUTOR** |

The decisive current-topology conclusion is that stopping the single PrintersHero Railway production service stops all observed current PrintersHero V1 application writers. This does not authorize a cutover: maintenance ingress, fresh stopped-replica evidence, restore-point procedure, reconciliation attestation, V2 read-only start, and the separate mandatory UI-convergence milestone remain required.
