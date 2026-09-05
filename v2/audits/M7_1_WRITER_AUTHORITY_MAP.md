# M7.1 writer authority map

**Status: completed source and limited runtime-topology inventory.** A writer in source is not proof that its worker gate is live. Production is confirmed as one V1 Railway replica from `main` `1326ad1b1bda70e478adc44b3b7ee3ccdf7e5102`; no V2 production server deployment was evidenced.

| Authority | Evidence / target | Cutover disposition |
| --- | --- | --- |
| V1 monolith routes | `server/index.ts` registers broad V1 customer, product, quote, order, production, fulfillment, payment, Stripe, QuickBooks and admin mutations | **STOP BEFORE V2**; V1 is the confirmed PROD authority |
| V1 migration startup | `server/index.ts:133-155` invokes `runMigrations`; its gate is unobserved and its advisory lock is V1-only | **STOP BEFORE V2**; P1 startup-write risk |
| V1 prepress poller | `processor.ts:28-37` marks all queued rows running but handles only the first returned row; `poller.ts:39-45` can claim concurrently | **STOP BEFORE V2**; P1 destructive/stranding risk |
| V1 preview / thumbnail workers | production source defaults these workers on; actual gates are unobserved | **STOP BEFORE V2**; asset/storage authority collision |
| V1 Stripe/payment/refund/reconciliation | V1 routes plus immediate/minute reconciliation in source unless disabled | **STOP BEFORE V2**; P1 financial/provider dual authority |
| V1 QuickBooks/email/inbound/portal | legacy QuickBooks owner is configuration-sensitive; route surface exists | retain only explicit compatibility exceptions; otherwise **STOP BEFORE V2** |
| V2 HTTP/lifecycle | `v2/src/interfaces/http/app.ts` and transactional lifecycle services | **START AFTER V2** only after repaired schema and topology proof |
| V2 QuickBooks/invoice/proof workers | `v2/src/deployment/server.ts` starts lease-based `FOR UPDATE SKIP LOCKED` queues | **START AFTER V2**; source-only, not PROD deployment evidence |
| MCP/external automation | MCP root is default nginx and `/health` says `1.0.0`; source/process/tool registry/credentials unknown | **P0 UNKNOWN — INVESTIGATE** |
| Vercel frontend | `www.printershero.com` is Vercel-served; project/deployment/env inspection unavailable | **P2 UNKNOWN**; checked-in configs are DEV-oriented |

## Authority rules and classifications

1. V1 and V2 must never be simultaneous authorities for payments, Stripe, QuickBooks, delivery/email, orders, prepress, production, fulfillment, inventory, or lifecycle.
2. Stop V1 migration and autonomous worker surfaces before V2 authority. With 320 queued production jobs and delivery exceptions, any stop/restart requires an approved reconciliation plan.
3. V2 queues/lifecycle code is not evidence of a live V2 runtime. The only confirmed PROD application authority is V1.
4. Before cutover, use authenticated read-only inspection to prove MCP reachability, intended V2 process commands, replicas, worker gates, ingress, and Vercel/Railway routing.

- **P0:** MCP mutation authority unknown; the independently observed ledger/schema divergence blocks V2 activation.
- **P1:** V1 prepress bulk claim, V1 migration startup, source-default reconciliation/asset workers, and financial/provider dual authority.
- **P2:** V2 worker behavior and Vercel production configuration are source/public-observation only.
