# M7.2E provider and ingress hold policy

This is a short maintenance-window policy. It does not transfer individual orders or replay uncertain work blindly.

| Component | While V1 is off | Required action | Recovery | Risk |
| --- | --- | --- | --- | --- |
| Stripe webhook delivery | Provider may retry a failed/unavailable endpoint; V1 must not apply state. | Stop V1 consumer; record provider retry/endpoint policy read-only. Do not disable a webhook without proving its recovery behavior. | After V2 is healthy, accept/reconcile idempotently from provider event identity. | P0 — unknown live Stripe configuration/retry window. |
| Direct Stripe/payment routes | Must not create intents, capture, refund, or apply local payment state. | Maintenance boundary rejects mutations before V1 stop. | Reconcile unresolved provider state; never blind retry. | P0 |
| QuickBooks | No periodic or direct push/pull/flush during boundary. | Stop consumers, close admin routes, snapshot queued/claimed/uncertain work. | V2 resumes only after provider/local identity reconciliation. | P0 |
| Gmail/email | No quote, proof, invoice, reminder or test send. | Stop V1 and block send routes; retain pending/ambiguous attempt records. | Reconcile provider-attempt ambiguity; do not resend by default. | P1 |
| Financial outbox | No claim or provider action. | Stop actual consumer and record queue/lease evidence. | Resume one owner after V2 readiness. | P0 — runtime owner unknown. |
| Portal and public token actions | No uploads, proof decisions, payments, or customer mutations. | Maintenance rejects all mutable portal/token paths. | Reopen only after V2 authority is deliberate. | P0 |
| MCP and external automation | No mutation tool invocation. | Stop/disable independently unless read-only registry proves no write target. | Re-enable only after target and tool scope are verified. | P0 |
| Scheduled delivery/cron | No side effects. | Railway inventory must prove no independent scheduled process remains. | Restart under one declared owner. | P0 |

The smallest safe policy is stopped consumers plus a bounded provider retry/receipt policy. There is no authorization or need for a queue-reset, per-record handoff ceremony, or provider write during this milestone.
