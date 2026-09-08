# M7.6B — Operational AI workspace and concrete V2 tool wiring

## Delivered boundary

The staff-only `/assistant` workspace is backed by durable, tenant/user-scoped conversations. It calls a server-only OpenAI-compatible provider adapter only when `V2_AI_ENABLED=true` and all provider settings are present. Provider credentials, raw provider responses, direct SQL, provider APIs, filesystem access, and arbitrary HTTP remain unavailable to the browser and model.

`assistant.use` is a dedicated staff capability, seeded only for Owner and Administrator templates. Every conversation, read, proposal, GO, and CANCEL request checks it; each registered tool also rechecks its own V2 capability.

The bounded orchestration loop records user/assistant/tool evidence, executes at most five registered reads, detects repeated calls in a decision, limits one user to twelve turns a minute, stores usage metadata (model/token counts when returned/duration), and fails closed on malformed or unavailable provider output. A provider can prepare a command but cannot execute it; the existing literal GO confirmation path revalidates the authenticated identity and current authority.

## Concrete read coverage

Four read tools are composed through existing tenant-aware V2 read adapters: `customer.search`, `product.search`, `quote.search`, and `order.search`. They return bounded summaries only. The remaining M7.6A read definitions remain contract-only and are deliberately absent from the runtime registry until their canonical shaped adapters are implemented.

## Command boundary

The workspace renders server-owned proposal, GO, and Cancel controls. One live command is registered: `order.production_not_required`. It delegates to the canonical workflow service, whose transaction reserves the business request, revalidates policy/current state at GO, audits the action, and reconciles the Order lifecycle. Review found the canonical customer/contact creation operations do not yet accept a durable business-request idempotency key. Exposing them through GO would risk duplicate records on retry, so those and all other commands fail closed rather than treating a proposal as safe execution.

## Deployment configuration

AI is disabled by default. An enabled deployment requires server-side `V2_AI_PROVIDER=openai_compatible`, `V2_AI_API_KEY`, `V2_AI_API_BASE_URL`, and `V2_AI_MODEL`; `V2_AI_TIMEOUT_MS` is bounded to 1–60 seconds. Incomplete optional AI configuration disables only AI and never creates a fallback. No production provider was contacted during this work.

The separately observed Vercel failure is configuration, not an AI source failure: `V2_UI_DEPLOYMENT_TARGET` must be `development` for the dev deployment, with `V2_UI_API_ORIGIN=https://api-dev.printershero.com`. No Vercel environment was changed in this milestone.

## Disposition

**PASS WITH FINDINGS** for the staff workspace, dedicated authorization, provider safety boundary, durable evidence, four concrete V2 read tools, and the safe workflow command. **Not release-complete for broad write-capable AI**: canonical idempotency seams and the remaining typed read adapters are required before broader command registration or operational coverage.
