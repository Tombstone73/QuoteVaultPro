# M7.4 production environment matrix

## Scope and evidence limits

This is a read-only inventory. Railway exposes variable names but redacts values and scopes; it proves presence, not resource identity, provider mode, callback correctness, or secret continuity. Vercel and Neon production-control-plane access remain unavailable as recorded in M7.3B. No target is classified production merely from a secret-bearing variable name.

| Resource/config group | Owner | Required | Current PROD presence | Target classification | M8 action |
| --- | --- | --- | --- | --- | --- |
| PostgreSQL `DATABASE_URL` | Railway/Neon | Yes | Present by name | Endpoint/fingerprint unproven | P0: reviewed production allowlist and independently pinned endpoint; no automatic migration |
| Reconciliation/migration URLs and `DRIZZLE_AUTO_MIGRATE` | Railway | Yes for controlled M8 only | Named controls absent | V1 defaults auto-migrate | Set/verify migration disabled on all application starts; only ephemeral executor may run SQL |
| Supabase URL/service role/bucket | Railway/Supabase | Yes for V2 artwork | All three names present | Project, bucket, policy, and DEV/PROD identity unproven | Read-only verify production project, private `titan-private` bucket, and V2 prefix authorization |
| Stripe keys/webhook secret | Railway/Stripe | Yes for payments | Names present | Live/test account and signing-secret coherence unproven | Confirm live account, V2 endpoint, signing secret, and Connect/account readiness |
| QuickBooks client/config/token key | Railway/Intuit | Yes when accounting released | Names present | Mode, redirect, realm, OAuth, and decryptability unproven | Configure/authorize production explicitly; keep worker disabled initially |
| Gmail client/config and canonical integration | Railway/Google/Postgres | Yes when delivery released | Google client names and public origin present | V2 DB readiness/sender/redirect/token unproven | Verify or deliberately adopt/re-authorize V2 integration before enabling queues |
| Session, AI, OAuth encryption | Railway | Yes | `SESSION_SECRET`, AI encryption, and QB encryption names present | Value isolation/rotation continuity unproven | Preserve effective key/key IDs; do not rotate without re-encryption plan |
| Public web/API/object origins | Vercel/Railway | Yes | Names present; Railway exposes API/object domains | Values and Vercel production routing unproven | Prove canonical `www`, API, callback and portal origins; never inherit DEV rewrites |
| V2 invoice/proof/QB workers | Railway/V2 | Yes, disabled for first V2 start | V2-specific controls absent by name | Unsafe defaults if V2 could start | Set invoice/proof false and QB owner non-queue before read-only start |
| V1 worker/migration controls | Railway/V1 | Yes during stop/recovery | Global/per-worker controls absent by name | V1 defaults migration/workers on | Freeze deploys; set/verify controls before any V1 restart; zero replicas remains authoritative |
| MCP and local file bridge | Source/optional local agent | No | No current deployed V2 writer authority | Future/optional | Not a cutover prerequisite |

## Current deployment facts

The authenticated Railway production project has one online service/replica, deployed from `Tombstone73/QuoteVaultPro` `main` at sanitized revision `1326ad1`. It exposes `api.printershero.com` and `objects.printershero.com`, not `www`. Its service has 42 redacted variables and no explicit start/predeploy override; deployed V1 starts through the package production command.

No production variable name itself proves a DEV target. Conversely, no safe target fingerprint was available for database, Supabase, Stripe, QuickBooks, Gmail, or public URL values, so all remain unverified rather than assumed ready.
