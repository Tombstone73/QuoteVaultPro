# M7.6B — AI Assistant readiness

## Disposition: PASS WITH FINDINGS

The optional staff AI feature has a real server-side provider path, durable conversation/pending-command/audit persistence, four concrete tenant-aware V2 reads, a dedicated staff capability, a usable V2 workspace, bounded orchestration, and one concrete write command (`order.production_not_required`) behind exact GO and canonical idempotency/state checks. No pre-GO business mutation path exists.

## Findings before broader rollout

- The provider path is intentionally non-streaming for the current OpenAI-compatible JSON response adapter. The workspace shows a bounded working state; server-sent text streaming is deferred until a provider contract can maintain the same tool/GO boundaries.
- Customer/contact creation and the remaining command contracts remain unregistered because their canonical operations have not yet proven a retry-safe business-request seam.
- Artwork, proofs, production, fulfillment, finance, inbound, and pricing have typed contracts but no composed safe read adapters in this runtime. They are absent rather than exposed through raw SQL.
- No safe DEV provider credential was available, so provider validation used deterministic local fakes only. No provider/business/production write occurred.
- The current Vercel failure remains an external DEV environment configuration requirement: `V2_UI_DEPLOYMENT_TARGET=development` and `V2_UI_API_ORIGIN=https://api-dev.printershero.com`. This milestone did not change Vercel or deploy.

## Required environment variable names

`V2_AI_ENABLED`, `V2_AI_PROVIDER`, `V2_AI_API_KEY`, `V2_AI_API_BASE_URL`, `V2_AI_MODEL`, and optional `V2_AI_TIMEOUT_MS`. When disabled or incomplete, AI is unavailable while core V2 startup continues; no fallback provider is used.
