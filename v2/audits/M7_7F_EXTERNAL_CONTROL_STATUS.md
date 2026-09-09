# M7.7F External Control Status

| Area | Status | Evidence / required action |
| --- | --- | --- |
| DEV Railway deterministic AI | Proven for M7 QA only | `V2_AI_ENABLED` and `V2_AI_QA_DETERMINISTIC_MODE` set on the existing DEV service; no external model call. |
| AI production provider | M8 human action | Production provider configuration/readiness was not inspected or changed. |
| Gmail production | M8 human action | Inbound read consent and real delivery remain outside this QA seam. |
| Stripe / QuickBooks production | Access required / M8 human action | Not changed or invoked. |
| Vercel production maintenance authority | Access required | Not reassessed during this bounded provider-safe work. |
| Neon production restore authority | Access required | Not reassessed and no production database action was taken. |
| Production cutover gates | P0 blocker | Existing write-free, maintenance, restore-point, manifest, reconciliation, endpoint-fingerprint, and controlled-startup evidence must be satisfied before GO. |
