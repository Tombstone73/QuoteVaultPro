# M7.2F final runtime authority

| Authority | Current read-only evidence | Cutover classification |
| --- | --- | --- |
| PrintersHero V1 API and in-process workers | One Railway service, one live replica, no cron. Live logs confirm asset-preview runs in this process. | **STOP WITH RAILWAY** |
| QuoteVaultPro standalone prepress entrypoint | Exists in source, but no separate service/cron in the PrintersHero project. Deployed V1 revision lacks M7.2D drain behavior. | **NOT CURRENTLY DEPLOYED IN THAT PROJECT; verify no external launcher** |
| `prepresshero-workers` | Separate live Railway production service with one replica, explicit worker command, live preflight/rendering/webhook consumers, and redacted DB/Supabase/storage/email configuration. | **STOP SEPARATELY OR PROVE ISOLATED — P0** |
| `prepresshero` API | Separate live Railway production API with redacted DB/Supabase/storage/email configuration. | **STOP SEPARATELY OR PROVE ISOLATED — P0** |
| `prepresshero` Redis/Gotenberg | Redis is live; Gotenberg is offline. Neither independently proves a PrintersHero DB writer, but they are dependencies of the active prepress project. | **IN SCOPE WITH PREPRESSHERO RESOLUTION** |
| MCP PROD/DEV | Tracked application contracts disable MCP and no deployed bridge/tool/auth/DB target exists. Current supplied context confirms future-only integration. | **NO CURRENT WRITE AUTHORITY — FUTURE INTEGRATION** |
| Local file bridge | Optional shop-side copier has no DB/Supabase/S3/provider credentials; its only state mutation is via Railway V1 routes. | **NO INDEPENDENT PROD DB WRITE AUTHORITY — FUTURE/OPTIONAL** |
| Stripe, QuickBooks, Gmail | Provider operations and local DB application occur through Railway-hosted code. No independent callback/worker was found in the PrintersHero project. | **STOP WITH RAILWAY** |
| Vercel | Connected access exposes development only; no production project/routing/maintenance control was proven. It is not a database writer. | **OPERATIONAL INGRESS GATE — P1** |
| V2 PROD runtime | No V2 production service was found in the PrintersHero project. | **MUST REMAIN ABSENT UNTIL ATTESTED** |
| Reconciliation executor | Direct, durable-lock guarded database process. | **SINGLE EXECUTOR** |

The decisive unknown is not hypothetical source code: it is the live external `prepresshero` deployment. Railway variable values are redacted, so this milestone cannot determine whether its `DATABASE_URL` or provider/storage configuration reaches PrintersHero production. No production connection was attempted.
