# PrintersHero AI Platform Audit

**Audit date:** 2026-07-21
**Scope:** static, audit-safe inspection of the main application repository and all MCP-related code available in this workspace. No runtime systems, production data, DEV endpoints, deployments, migrations, or application behavior were touched.

## 1. Executive Summary

### Current readiness

**Partially ready for a read-only assistant; not ready for autonomous or broad write execution.** The application already has a React/Express/Drizzle foundation, authenticated tenant-scoped routes, a large operational API surface, an organization-scoped AI settings/usage foundation, and mature product/price workflow code. It does not yet have a general conversation engine, context contract, tool registry, confirmation ledger, or uniform authorization and idempotency boundary for AI writes.

### Major strengths

- Tenant context is established server-side by `server/tenantContext.ts`, including membership validation for `x-organization-id`, inactive-org rejection, and portal/internal separation.
- The production business application already owns domain workflows through routes, services, storage repositories, Zod contracts, and Drizzle schema definitions. Examples include `server/routes/orders.routes.ts`, `server/routes/quotes.routes.ts`, `server/routes/products.routes.ts`, `server/services/orderStateService.ts`, and `server/storage/orders.repo.ts`.
- Existing AI work has useful safety patterns: org-scoped settings, encrypted BYOK material, provider resolution, feature flags, usage rows, prompt-versioned structured outputs, and advisory-only validators. See `shared/aiFoundationContracts.ts`, `server/services/ai/*`, `server/db/migrations_v2/0084_ai_foundation.sql`, and `server/services/productIntakeWizard/*`.
- The frontend has an established application shell, global search, React Query hooks, Radix/shadcn primitives, `react-resizable-panels`, and multiple local-preference patterns. See `client/src/components/layout/AppLayout.tsx`, `GlobalSearchOverlay.tsx`, `ResizablePanels.tsx`, and `client/src/hooks/useUserPreferences.ts`.

### Major gaps

- No general assistant conversations/messages/session schema or orchestration endpoint exists.
- No inspected MCP server implementation or registered MCP tools exists in this repository; the stated external MCP deployment cannot be audited from this workspace.
- Existing domain authorization is route/service-specific, not a reusable tool-permission matrix; several legacy paths access `storage` directly.
- Global search loads complete order/quote/invoice collections and filters in memory in `server/routes/search.routes.ts`; it is a useful capability but not a scalable reporting/tool boundary.
- `audit_logs` exists, but audit coverage is not universal and does not model plan/preview/confirm/execute causality. Undo is domain-specific.
- Idempotency exists for selected integrations and workflows (`portal_follow_up_items`, payments, inbound orders) but not a platform-wide mutation contract.

### Largest risks

1. Letting an LLM invoke existing mutable routes directly would couple model output to inconsistent authorization, retries, and state transitions.
2. A server-to-server MCP identity without a verified end-user/org delegation token could violate the “AI acts as logged-in user” rule.
3. Prompt injection from external research, inbound email, PDFs, and uploaded artwork could be mistaken for tool instructions.
4. Product/PBV2/pricing or order lifecycle writes can create irreversible downstream financial and production effects.

### Recommended smallest safe path

Build one backend-owned assistant orchestration API with a **strictly allowlisted, read-only v1 tool registry**, then render it in one presentation-independent frontend workspace. Reuse existing authenticated domain read services and global-search/navigation paths; do not expose raw SQL, direct database access, MCP write tools, or existing arbitrary routes to the model.

### Build first / do not build yet

Build first: launcher and workspace shell, persisted conversation records, route/entity context snapshot, read-only customer/order/product/search/operational-summary tools, source links, per-org AI feature flag, usage/audit telemetry, and graceful unavailable state.

Do not build yet: generic writes, product activation, pricing updates, payments, inventory adjustments, state transitions, browser/RPA automation, direct SQL, external web execution, customer-facing assistant actions, marketplace skills, or a broad MCP tool catalog.

## 2. Current-State Architecture

| Area | Confirmed repository finding | Assessment |
|---|---|---|
| Frontend | React 18/Vite/Tailwind with BrowserRouter bootstrapped in `client/src/main.tsx`, TanStack Query, Radix/shadcn patterns; `client/src/App.tsx`, `client/src/components/layout/*`, `client/src/hooks/*`. | Suitable host for a shell-only assistant workspace. |
| Backend | Express entrypoint `server/index.ts`; a large `server/routes.ts` plus extracted route modules under `server/routes/`; service and storage layers coexist. | Domain layer is usable, but route/service/repository boundaries are uneven. |
| Database | PostgreSQL through Drizzle (`shared/schema.ts`, `server/db.ts`); versioned migrations in `server/db/migrations_v2/`, latest inspected journal entries through `0123_product_shop_name.sql`. | New assistant tables require new immutable v2 migrations. |
| Authentication | Session/passport-related dependencies and `server/localAuth.ts`/`server/replitAuth.ts` are registered from `server/routes.ts`. | Confirm exact production identity provider during implementation; do not assume JWT as older documentation does. |
| Authorization/tenancy | `tenantContext` resolves `req.organizationId`/`req.orgRole`, verifies membership, blocks portal identities, and rejects archived/deleted orgs (`server/tenantContext.ts`). Routes commonly apply `isAuthenticated, tenantContext`. | Strong starting point; all tools must enter through this same request/delegation context. |
| AI code | AI foundation, bug reviews, triage briefs, product-planning and intake services are present. AI settings are organization scoped; secrets are encrypted and safe DTOs omit them. | Reusable foundation, not a conversational tool-calling platform. |
| Reporting/search | `GET /api/search` and `GET /api/operational-summary` are authenticated/tenant-scoped; dashboard hooks also exist. | Useful v1 sources; current search is not a report-query engine. |
| Audit/history | `audit_logs` and domain event/history tables such as `job_status_log`, `production_events`, `fulfillment_events`, and payment webhook rows exist. | Keep domain history canonical; add AI execution/audit causality. |
| Deployment | README declares Vercel frontend/Railway backend. The checked-in `vercel.json` proxies `/api` and `/objects` to `https://api-dev.printershero.com`; migration startup is enabled by default in `server/index.ts` unless `DRIZZLE_AUTO_MIGRATE=0`. | This checkout is DEV-targeted; MAIN mapping/promotion and MCP deployment configuration are not confirmed here. |

**Confirmed versus assumption.** Statements above cite inspected files. The requested separate deployed MCP server, n8n workflow definitions, live Supabase object configuration, database RLS state, remote schema ledger, performance baselines, and MAIN deployment configuration were **not available** in this checkout; references to them below are explicit recommendations/unknowns, not confirmed facts.

## 3. Reusable Existing Components

| Component/service | Location | Current responsibility | Reuse recommendation / required change | Risk |
|---|---|---|---|---|
| Tenant context | `server/tenantContext.ts` | Resolves active org and role; rejects invalid/portal access | Mandatory entry for assistant requests; add immutable actor/delegation context, never accept org from model input | High if bypassed |
| AI settings + resolver | `shared/aiFoundationContracts.ts`, `server/services/ai/aiSettingsService.ts`, `aiProviderResolver.ts`, `server/storage/aiFoundation.repo.ts` | Per-org enablement, provider selection, encrypted API keys, usage records | Extend feature flags/capabilities for assistant; retain secret handling and safe DTO pattern | Medium |
| Product Intake / AI Product Builder | `client/src/pages/admin/CatalogMigrationLab.tsx`, `server/routes/catalogMigrationLab.routes.ts`, `server/services/productIntakeWizard/*`, `shared/productIntakeWizardSchemas.ts` | Guided analysis, persisted intake questions/answers, inactive draft creation/review/activation | Reuse schemas, diagnostics, readiness checks and draft-review gates as later Product Management skill internals; do not wrap its UI as chat | High |
| PBV2 | `client/src/components/pbv2/builder-v2/*`, `shared/optionTreeV2.ts`, PBV2 services/routes | Product option-tree validation, calculations and persistence | Reuse only behind product service tools with explicit previews; preserve server-authoritative validation | Critical |
| Domain routes/services | `server/routes/{customers,quotes,orders,products,pricing,productionJobs,fulfillment,mvpInvoicing}.routes.ts`, `server/services/*`, `server/storage/*` | Existing business actions and reads | Create thin tool adapters that call canonical services; do not make LLM call HTTP routes or repos directly | High |
| Global search | `server/routes/search.routes.ts`, `client/src/hooks/useGlobalSearch.ts`, `GlobalSearchOverlay.tsx` | Cross-domain navigation results | Reuse output/link conventions after replacing in-memory scans and raw query/result logging with bounded query-level access | Medium |
| Operational summary | `server/routes/operationalSummary.routes.ts`, `server/services/operationalSummary.ts` | Tenant-scoped operational counters | First operational-question tool; return source cards, not model-generated facts | Low |
| Audit repository | `shared/schema.ts#auditLogs`, `server/storage/audit.repo.ts` | Tenant-scoped generic audit events | Reference/link canonical events; add dedicated AI plan/execution tables rather than overload `newValues` | Medium |
| Layout/panel primitives | `client/src/components/layout/AppLayout.tsx`, `ResizablePanels.tsx`, `SplitWorkspace.tsx`, `client/src/components/ui/{sheet,dialog,resizable}.tsx` | Shell, panels, locally stored sizing | Reuse styling/primitives; create isolated `assistant` layout state and avoid domain mutations in UI | Low |
| Preferences | `client/src/hooks/useUserPreferences.ts`, `useOrgPreferences.ts` | Local stub user preferences and server org preferences | Use local preferences only for MVP layout; add server user-scoped preferences before cross-device persistence | Low |

## 4. Missing Platform Components

| Component | Timing | Existing equivalent | New schema likely? | Key risks |
|---|---|---|---|---|
| Conversations/messages/sessions | Now | Product intake sessions are workflow-specific | Yes | Retention and privacy |
| Context snapshots | Now | Prompt input snapshots in AI reviews/intake | Yes | Sending stale or sensitive fields |
| Tool registry + metadata | Now | Scattered routes/service methods | Code first; schema later if admin-managed | Drift from domain permissions |
| Skill registry | Later (static v1 metadata now) | Feature flags only | No initially | Skill overreach |
| Execution plans/pending confirmations/tokens | Before any write | Product intake review/activation gates | Yes | Replay and TOCTOU |
| Tool execution records + AI audit logs | Now | `audit_logs`, AI usage | Yes | Missing causality, sensitive payload retention |
| Usage/cost records | Now | `ai_usage` | Extend existing table/metadata or add request table | Provider accounting accuracy |
| Saved reports | Later | None confirmed | Yes | Query scope/versioning |
| Assistant layout preferences | MVP local; later server | `useUserPreferences` localStorage stub | Later | Cross-device expectations |
| Provider abstraction | Now | `AiProviderAdapter`/configured provider | Extend | Provider-specific tool semantics |
| External research gateway | Later | None confirmed | Usually no initially | Prompt injection and egress |
| Tool permission metadata | Now | Route-specific RBAC | Code + tests; optional schema | Privilege escalation |
| General idempotency/undo metadata | Before writes | Domain-specific keys/events | Yes | Duplicate/partial writes |

## 5. Assistant Engine Architecture

Choose a **main-backend orchestration service**: `POST /api/assistant/conversations/:id/turns` accepts user text and a validated UI context envelope after `isAuthenticated` + `tenantContext`. The backend builds trusted actor/tenant context itself, invokes an allowlisted registry of tool adapters, persists events, and returns structured cards plus text. The model never receives DB credentials, service objects, secrets, or write authority.

Proposed lifecycle:

1. Resolve user, organization, role, AI feature/cost guard and conversation ownership.
2. Validate/minimize the UI-supplied context; server re-resolves referenced records.
3. Classify intent only into enabled skills and allowed tool domains.
4. Build a typed plan using constrained schemas; reject unregistered calls.
5. Execute read tools; attach source record IDs/routes and freshness timestamps.
6. For a write, persist a canonical plan with record version/fingerprint and produce a preview. No mutation occurs.
7. Require a typed explicit confirmation (`GO` mapped by UI to a plan-bound token, not free text alone).
8. Reauthorize and reload affected records; reject changed/stale plans; execute a service-level command with idempotency key.
9. Persist outcome and AI/domain audit links; summarize with source links and safe undo option.

State machine:

`new -> collecting_context -> planning -> awaiting_input | running_read_tools -> responding -> complete`
`planning -> awaiting_confirmation -> revalidating -> executing -> succeeded | partially_failed | failed | expired | cancelled`.

Failures are first-class events. A transient provider failure returns a saved draft turn and retry affordance; a tool failure includes per-tool status; no automatic retries for non-idempotent writes. Conversation persistence stores user message, sanitized model/tool events, provenance, prompt/tool versions, and summary—not raw secrets or unrestricted source content.

## 6. Assistant Workspace UI

Implement `AssistantWorkspaceProvider` at the authenticated application shell level, with one state model: `{presentation, bounds, dockSize, minimized, fullscreen, conversationId, context, pendingPlan}`. Presentation values: `floating`, `dock_left`, `dock_right`, `dock_bottom`, `minimized`, and `fullscreen`; all render the same conversation/workspace component.

- **Launcher:** top-right `TitanTopBar`/`AppLayout` integration, gated by capability endpoint.
- **Floating:** portal-based, viewport-clamped draggable/resizable panel; persist only after drag/resize end.
- **Docked:** use existing `react-resizable-panels`/`ResizablePanels.tsx` patterns and make app content reflow rather than overlaying controls.
- **Mobile:** bottom sheet/full-screen only; no free drag or multi-panel docks.
- **Preferences:** local key namespaced by user+organization for MVP; later `user_assistant_preferences` server record. Do not place user layout in organization-wide `settings.preferences`.
- **Keyboard:** `Cmd/Ctrl+J` toggle (after conflict audit), Escape minimizes/cancels input but never confirms, and Enter submits only a draft. Shortcuts must be disabled within editable controls as appropriate.
- **Context indicator:** visible organization, route, entity label/ID, selected count, and “context refreshed at”; allow remove/refresh. Never claim unseen context.
- **Execution UX:** tool cards expose status, source links, timestamps, and warning state. Confirmation is a dedicated review card with diff, affected record count, expiry, and a button that submits the plan token; it must not be inferred from prose.

The UI has no business rules: it renders server-provided action availability, validation errors, previews, and result links.

## 7. Context Model

Priority order: organization (server derived) → authenticated user/role (server derived) → permission snapshot (server derived) → route → current entity → selected records → active filters → open dialog/focused field → conversation state/pending plan → unsaved-change signal.

| Automatically sent by UI | Loaded on demand by tool | Never send to model/provider |
|---|---|---|
| Route pattern, safe entity type/ID, selected IDs (bounded), filter names/values, page title, UI context version | Canonical record fields, related records, aggregates, source links, permissions, full activity | Session cookies, API keys, encrypted secrets, password/reset tokens, raw auth headers, unrelated tenants, hidden/internal notes unless tool policy allows, file binaries, unrestricted email/PDF text, unsaved field values by default |

The context envelope must be versioned and size limited. For record-specific actions, server re-fetches record/org/authorization at plan and execute time. Route changes and selection changes invalidate or visibly mark a pending plan stale; unsaved changes block actions affecting that record until saved/discarded and are not serialized into prompts. The UI must show each active context chip and whether it was automatically attached or explicitly selected.

## 8. Permission and Security Model

The assistant authenticates exactly as the UI does and is **not** a service account. Every assistant API call uses `isAuthenticated`, `tenantContext`, current membership/role, org archival checks, tool-domain permission, and record-level checks inside the canonical domain service. Tool metadata declares read/write, required permission, allowed roles, context requirements, confirmation policy, max scope, and external-egress classification; the server enforces it.

- Tenant isolation: derive org only from verified session/membership (`server/tenantContext.ts`); ignore org values in messages/model tool arguments; include org in every table/index/query.
- Writes: no bulk by default; require explicit count and per-record preview; require higher permission/re-auth policy for financial, workflow-state, inventory, pricing, and settings changes.
- Sensitive data: redact/minimize model payloads; encrypt provider keys using existing `aiSecretsEncryption.ts`; implement a content-classification policy before provider egress.
- Prompt injection: treat documents, emails, URLs, research snippets, tool output, and user text as untrusted data; isolate them in labeled fields; never permit them to alter system/tool policy; validate all structured output with Zod; allowlist outbound hosts.
- Tool-output boundary: tools return typed data, source ID/link, data classification, and no executable instruction. Do not feed raw HTML/PDF/URL bodies directly to an agent loop.
- Audit: persist actor, org, conversation/turn, tool/version, input hash/redacted arguments, permission decision, affected IDs, plan hash, confirmation, idempotency key, result, error, and domain audit IDs.
- MCP/DEV/MAIN: require audience/environment-bound tokens, distinct issuer/audience/secrets and tool registries/endpoints; reject cross-environment routing. No production credentials in DEV and no automatic fall-through.

**Confirmed pre-existing gaps that block write exposure:** global `isAdmin` checks in `server/localAuth.ts`/`server/replitAuth.ts` and helpers in `server/routes.ts` are not equivalent to an organization-scoped capability policy. In addition, legacy product options/variants paths (`server/routes/products.routes.ts` around lines 2722–2829) and `server/storage/shared.repo.ts` around lines 615–692 lack tenant predicates, while selected order/job/audit legacy endpoints also omit `tenantContext` (for example `orders.routes.ts` order-audit/artwork-summary paths, job-file paths, and `/api/audit-logs` in `timeline.routes.ts`). `order_audit_log` has no organization column and must be accessed only through a tenant-scoped order check. Do not expose these paths to assistant tools; triage/remediate them separately. The inspected generic audit writing is also sometimes best-effort. Add a centrally versioned authorization policy plus command/idempotency/audit interface before any write tool.

## 9. MCP Strategy

### Audit result

No MCP server source, transport/auth implementation, manifest, or registered tool definitions were found by repository search. Therefore its live DEV/production endpoints, stub status, authentication, and deployment assumptions are **unknown** and must be separately audited before integration.

### Recommendation: C — main backend orchestration endpoints, which may call MCP

The assistant frontend calls the main backend only. The backend owns conversation, context, authorization, previews, confirmation, idempotency, and audit. It may call MCP only through a narrow integration gateway for non-core/external capabilities (vendor research, specialist integrations, possibly read-only connectors). Core PrintersHero commands remain backend service calls. This is especially important because `server/lib/runtimeEnvironment.ts` uses heuristic runtime detection and `vercel.json` is DEV-targeted; environment selection must be explicit in token audience/endpoint configuration rather than inferred.

| Option | Assessment |
|---|---|
| A. Browser/assistant calls MCP directly | Reject: makes user delegation, audit, confirmation, and environment boundaries too easy to bypass. |
| B. Main backend only | Best for core commands and MVP. |
| C. Backend then MCP | Recommended hybrid shape for external integrations; backend remains policy enforcement point. |
| D. MCP as both internal execution and external integration | Defer; only feasible if every tool is a thin, authenticated adapter over canonical backend commands. |

If MCP is retained, its tools should be versioned (`domain.action@v1`), carry declarative metadata mirroring backend policy, require a short-lived user+org delegation JWT minted by the main backend, bind audience/environment/tool allowlist, and return typed non-authoritative external results. MCP must not receive database credentials or a general internal service account. It should not own conversations, confirmation state, or product/order workflow authority.

## 10. Tool Catalog v1

Stage 1–2 are read-only. “Existing surface” identifies a reuse seam, not authorization to invoke it without an adapter.

| Tool | Purpose | Mode / permission | Required context | Existing surface | Confirm / undo / idempotency | Risk / stage |
|---|---|---|---|---|---|---|
| `navigation.open_record` | Produce safe internal record link | Read; authenticated internal user | entity type/id | `client/src/config/routes.ts` | No / N/A / N/A | Low / 1 |
| `search.global` | Bounded customer/contact/order/quote/invoice/job lookup | Read; internal user | query | `server/routes/search.routes.ts` | No / N/A / N/A | Medium / 2 |
| `customers.get_summary` | Customer identity, balances, recent documents | Read; CRM view | customer ID | customers route/storage | No / N/A / N/A | Medium / 2 |
| `quotes.get_summary` | Quote status/lines/links | Read; quote view | quote ID | `quotes.routes.ts` | No / N/A / N/A | Medium / 2 |
| `orders.get_summary` | Order state, line items, job/fulfillment/invoice links | Read; order view | order ID | `orders.routes.ts`, `orders.repo.ts` | No / N/A / N/A | Medium / 2 |
| `products.get_summary` | Product/PBV2 status and safe metadata | Read; product view | product ID | `products.routes.ts`, PBV2 reads | No / N/A / N/A | Medium / 2 |
| `pricing.explain_quote` | Return canonical calculated price components, no recomputation by model | Read; pricing view | quote/line ID | pricing/quote calculation services | No / N/A / N/A | High / 2 |
| `inventory.get_material_status` | Stock/low-stock/vendor snapshot | Read; inventory view | material ID/filter | materials/procurement routes | No / N/A / N/A | Medium / 2 |
| `production.get_status` | Job/station/proof readiness | Read; production view | order/job ID | production routes/services | No / N/A / N/A | Medium / 2 |
| `fulfillment.get_status` | Shipment/pickup/checklist snapshot | Read; fulfillment view | order/shipment ID | `fulfillment.routes.ts` | No / N/A / N/A | Medium / 2 |
| `invoices.get_ar_status` | Invoice/payment/overdue snapshot | Read; finance permission | invoice/customer/filter | `mvpInvoicing.routes.ts` | No / N/A / N/A | High / 2 |
| `reports.operational_summary` | Canonical backlog/counter view | Read; internal user | optional filters | `operationalSummary.routes.ts` | No / N/A / N/A | Low / 2 |
| `customers.update_contact` | Later narrow CRM edit | Write; CRM edit | customer/contact + expected version | customer service | Yes / safe field reversal / required | High / 5 |
| `quotes.add_internal_note` | Later append-only staff note | Write; quote edit | quote ID | quote domain service | Yes / soft delete if supported / required | Medium / 5 |
| `products.create_inactive_draft` | Later create inactive reviewed draft only | Write; catalog admin | validated intake session | `productIntakeDraftService.ts` | Yes / abandon/delete policy / required | Critical / 6 |
| `pricing.propose_override` | Later plan-only pricing proposal | Plan only; pricing admin | product/quote context | pricing/PBV2 services | Preview only / no direct undo / N/A | Critical / 6 |
| `research.vendor_or_competitor` | Later isolated external research | Read external; explicit egress entitlement | query + approved sources | new gateway/MCP integration | No / N/A / request-id | High / 8 |

No payment, refund, invoice finalization, inventory adjustment, order state transition, product activation, or settings tool belongs in v1.

## 11. Skills Framework

Skills are versioned policy/configuration modules, not arbitrary prompts. Router selects only from enabled skills based on intent, route/entity, requested operation, permissions, data classification, and confidence; low confidence asks a question or uses General Assistant. A skill can narrow tool access but cannot grant permissions.

| Skill | Allowed tool domains / context | Permission / confirmation | Phase |
|---|---|---|---|
| General Assistant | Navigation, global search, safe operational reads; route context optional | Standard internal read; none | Initial |
| Order Assistant | Orders, quotes, production, fulfillment read summaries; order/quote context | Order view; writes later require plan/GO | Initial read / later write |
| Product Management | Product/PBV2 read; intake sessions/drafts | Catalog view/admin; all writes confirmed | Later |
| Pricing Expert | Canonical pricing explanations and simulations | Pricing view/admin; no direct price write initially | Later |
| Customer and CRM | Customers/contacts/read reporting | CRM view/edit; writes confirmed | Initial read / later write |
| Reporting Analyst | Predefined aggregates/saved reports | Reporting permission; read only until export policy exists | Initial |
| Inventory Assistant | Materials/availability/usage | Inventory view/edit; adjustments later only | Later |
| Production Assistant | Jobs/prepress/proof/fulfillment reads | Production view; state changes later | Later |
| Import Assistant | Import inspection/dry-run only | Import admin; explicit batch confirmation if ever enabled | Later |
| SMTP Configuration | Settings diagnostics only | Owner/admin; configuration writes high-risk confirmation/re-auth | Later |

## 12. Confirmation and Execution Model

For every write: (1) parse request; (2) resolve bounded scope; (3) authorize tool + records; (4) build a versioned execution plan; (5) reload affected rows and collect expected versions/hashes; (6) generate preview/diff/side effects; (7) request missing fields; (8) persist `awaiting_confirmation`; (9) accept only an explicit UI confirmation bound to the plan token (display “GO” but submit token); (10) reauthorize/reload/revalidate; (11) execute canonical command with idempotency key; (12) record individual successes/failures; (13) write AI and domain audits and return links; (14) expose undo only when domain has a safe compensating action.

Confirmation tokens must be user/org/conversation/plan/version bound, single-use, signed or stored hashed, and expire (recommend 10 minutes; 2 minutes for financial/settings/high-risk actions). Any relevant record version, permission, org context, route scope, selected-ID set, or plan payload change expires the plan. Partial failure never triggers a blind retry: show per-item results and offer a new plan for only safe uncompleted work. “GO” in ordinary chat text cannot execute a plan without a current server-side token.

## 13. Reporting and Analytics Strategy

Start with typed, tenant-scoped report tools for common questions—not model-generated SQL. The present reports page (`client/src/pages/reports.tsx`) is a placeholder; no report builder or saved-report schema was found. A valuable specialized read surface already exists in `GET /api/admin/pricing-audit` (`server/routes/pricingAudit.routes.ts`), which joins active products, PBV2 versions, materials, and pricing formula library under tenant scope.

- top material purchasers by bounded period (`PVC last month`);
- comparative period aggregates with an explicit baseline definition (`higher/lower than normal`);
- inactivity cohorts using last order/quote dates;
- margin change from canonical quote/order pricing snapshots where availability is validated;
- overdue invoice aging; and
- artwork/proof/prepress blocking-job queues.

Each tool owns a Zod input contract, fixed joins, date boundaries/time zone, organization predicate, permission check, max range/rows, timeout, provenance rows, and links to source records. Build aggregation queries/repositories, indexes, and explain plans before exposing high-cardinality questions. The existing `GET /api/search` is a navigation primitive, but its `getAllOrders`/`getAllQuotes` and full invoice read/filter pattern should not be used for analytics at scale. `GET /api/operational-summary` (`server/services/operationalSummary.ts`) is a good first curated aggregate.

**Do not allow direct model-generated SQL.** If ad hoc analytics is later justified, compile a restricted analytical DSL to reviewed read-only query templates on a replica/read role, with mandatory tenant predicates, cost/row/time limits, query logs, no mutations/DDL, and human rollout approval. Return data tables/source links first; charts are frontend renderings of validated result sets, exports are asynchronous permission-checked jobs, and saved reports store template + parameters + owner/org rather than SQL.

## 14. Product Builder Transition Plan

The AI Product Builder appears as the guided AI mode of `client/src/pages/admin/CatalogMigrationLab.tsx`, backed by `server/routes/catalogMigrationLab.routes.ts` and `server/services/productIntakeWizard/*`. It persists intake sessions, questions/answers, diagnostics, readiness, creates inactive product drafts, supports review/pricing patch, and activates through gated endpoints. `shared/productIntakeWizardSchemas.ts` and the product intake tests are reusable contracts/evidence.

Keep: PBV2 option-tree schemas/validators (`shared/optionTreeV2.ts`), pricing and product services, the inactive-draft + review + activation workflow, diagnostics/prompt versions, and draft review UI as the detailed workspace. Retire neither the calculator nor validation gates. Do not have chat create a published product.

Transition: Phase 1 lets a Product Management skill answer product questions and launch/deep-link the existing builder. Phase 2 lets chat collect structured intake answers and create the same inactive session/draft via an adapter. Phase 3 presents canonical draft-review cards and opens the established editor for PBV2/pricing changes. Activation remains the existing explicit review path until a separately audited command can match every validation and audit invariant.

## 15. Data Model and Migration Plan

All additions use new migrations in `server/db/migrations_v2/`; existing migration files/journal are immutable.

| Proposed table/column | Purpose/key fields | Scope/relationships | Retention/indexing | MVP / risk |
|---|---|---|---|---|
| `ai_conversations` | id, org_id, user_id, title, status, skill, context policy/version | org+owner user | Retention policy; `(org_id,user_id,updated_at)` | MVP / medium |
| `ai_messages` | conversation_id, sequence, role, sanitized content, status, provider metadata | org through conversation | Redact/TTL raw content; unique sequence | MVP / medium |
| `ai_context_snapshots` | hash, route/entity/selection/filter JSON, captured/expired timestamps | org+conversation/turn | Minimal data; `(org_id,conversation_id,created_at)` | MVP / high privacy |
| `ai_turns` | request/response status, model, prompt/tool versions, latency, usage link | org+conversation | Hash/redact payload; status index | MVP / medium |
| `ai_execution_plans` | action, normalized args, affected IDs/version hashes, preview, risk, expiry, status | org+user+conversation | single active/expiry indexes | Before writes / high |
| `ai_confirmations` | plan id, token hash, user, confirmed/expired/used timestamps | org+plan | Unique plan/token; short retention | Before writes / critical |
| `ai_tool_executions` | turn/plan, tool/version, args hash, authorization/result/error, idempotency key | org+actor | `(org_id,tool,created_at)` and idempotency unique | MVP read; required writes / high |
| `ai_audit_events` | immutable cross-link to `audit_logs`, plan/tool/actor/outcome | org | Append-only, long retention | MVP / medium |
| `ai_saved_reports` | report template/version, parameters, owner, sharing | org+user | `(org_id,owner,updated_at)` | Later / medium |
| `user_assistant_preferences` | user/org, presentation/bounds/sizes/shortcut prefs | org+user | unique `(org_id,user_id)` | Later / low |
| `ai_usage` extension or `ai_model_requests` | provider request ID, tokens/cost/latency/error | org+turn | Aggregate/query indexes | MVP / medium |

Avoid storing raw prompt transcripts, binary documents, secrets, cookies, or unredacted provider payloads by default. Store immutable references/hashes and source IDs instead. Add optimistic-concurrency/version fields only where canonical domain records lack a reliable updated-version semantic; do not alter all tables preemptively.

## 16. Observability and Cost Controls

Emit structured, redacted logs correlated by request, org, user, conversation, turn, plan, tool execution, provider request, and domain audit ID. Track tool latency/error class, model latency/tokens/estimated cost, authorization denial, plan expiry, confirmation conversion, and partial failure. Reuse `ai_usage` (`shared/schema.ts`, `server/storage/aiFoundation.repo.ts`) but add request-level correlation.

Enforce organization and user quotas (requests/tokens/cost/concurrent runs), tool timeouts, bounded output sizes, per-provider circuit breakers, and read-only retry policy with jitter. Non-idempotent commands have no automatic retry. Provide feature flags for shell, read tools, each skill, each write tool, provider, and external research; provide org and global kill switches. When AI is unavailable, the launcher reports unavailable and all existing business UI/routes remain fully usable.

## 17. Parallel Implementation Workstreams

| Workstream | Scope/dependencies | Likely areas | Parallel safety / validation | Model / effort |
|---|---|---|---|---|
| Assistant frontend shell | Presentation-state UI; depends only on capabilities contract mock | `client/src/components/layout`, new assistant feature | Safe parallel; component/unit/accessibility tests | GPT-5-Codex / M |
| AI backend platform | Conversations/turns/provider boundary; needs migration decision | `server/services/ai`, `server/routes`, `shared/schema`, migrations | Parallel after table contract; unit/integration tests | GPT-5-Codex / L |
| Context and permissions | Context schema, tool policy, actor delegation | `server/tenantContext.ts`, middleware/services, shared contracts | Start now; threat tests, cross-tenant tests | GPT-5-Codex / L |
| MCP gateway | Inventory current server first; adapter only | new gateway + MCP repo | Can start audit/design; blocked by MCP source/auth | GPT-5-Codex / M |
| Read-only tools | Search/domain adapters/source cards | routes/services/storage | Parallel after policy interface; fixture/tenant tests | GPT-5-Codex / L |
| Reporting engine | Curated aggregates/templates | new reports service/repos/indexes | Parallel with read tools; explain/load tests | GPT-5-Codex / L |
| Confirmation/execution | Plan/token/idempotency/audit command wrapper | AI services/schema/domain adapters | Blocked until writes approved; failure/replay tests | GPT-5-Codex / L |
| Product/pricing skill | Adapter to intake/PBV2 only | product intake/PBV2/pricing | After execution framework; regression/smoke fixtures | GPT-5-Codex / XL |
| Testing/security review | Test harness, threat model, test tenants | `server/tests`, `client/src/tests`, `e2e` | Begins now; gates every stage | GPT-5-Codex / L |

Assistant shell, backend data-contract design, policy/context, read-only adapters, and security tests can begin simultaneously once the conversation/context/tool schema is approved. Writes, MCP production use, and product/pricing work remain blocked by the command-policy and MCP unknowns.

## 18. Phased Implementation Plan

| Stage | Goal / included scope | Excluded scope | Dependencies, risks, tests, done / environment |
|---|---|---|---|
| 1. Foundation and assistant shell | Feature-gated launcher, shared workspace states, schema/contracts, unavailable UX | Model calls, domain tools, writes | Context contract; UI tests. Done when UI cannot affect workflows. DEV yes; MAIN only flag-off/canary. |
| 2. Read-only assistant | Conversations, read tools/search/summary, citations | Writes, raw SQL, external research | Provider/policy/usage; tenant and output-schema tests. DEV yes; MAIN gated. |
| 3. Page context | Trusted route/entity/selection context and visible chips | Unsaved-field transmission | Context invalidation; route-change/security tests. DEV yes; MAIN gated. |
| 4. Confirmation and audit | Plans, preview, tokens, execution ledger; still no broad writes | Domain mutations beyond a dry-run adapter | Migration and audit contracts; replay/expiry tests. DEV yes; MAIN feature-off. |
| 5. Limited write actions | One reversible narrow CRM/append-only command | Financial/state/PBV2/inventory actions | Canonical command + idempotency; staging/DEV integration tests. MAIN tightly canaried. |
| 6. Product and pricing skill | Intake-to-inactive-draft and price explanation | Activation/direct price change | PBV2 regression suite; manual DEV validation. MAIN after owner approval. |
| 7. Advanced reports | Curated aggregates, charts, exports/saved reports | Arbitrary SQL | Query budgets/index/load tests. DEV then gated MAIN. |
| 8. External research | Isolated gateway, source cards, injection defenses | Tool-chaining external content into writes | Egress/auth red-team tests. DEV first; MAIN explicit approval. |
| 9. Expanded skills | Inventory/production/import/settings narrow workflows | Autonomous multi-step workflow changes | Per-skill threat/rollback plans. DEV then staged MAIN. |
| 10. Marketplace | Tenant-managed skill/catalog ecosystem | Unreviewed executable plugins | Governance/sandbox/billing architecture. Not safe for MAIN until separate program. |

## 19. First Implementation Milestone

**Milestone: “Ask PrintersHero — Read-only Contextual Search.”**

Exact scope: a top-right launcher (inside staff `AppLayout`, not portal/public/print views); floating, dock-left/right/bottom, minimized and full-screen shell; local layout persistence; server-persisted conversations/messages; page route context with visible chips; bounded read-only customer/order/product/PBV2/global-search/operational-summary tools; answer cards with route links and freshness; organization feature flag/capability check; model/tool usage and audit telemetry; error/unavailable state. Do not use `Ctrl/Cmd+K`, which the existing top bar reserves for global search.

Exclusions: all write tools, confirmation UI that could execute actions, product draft creation, pricing changes, external research, arbitrary reports/SQL, file/document content ingestion, MCP dependency, attachments, billing/payment data beyond a separately permission-gated read summary, and customer portal use. Success is visible value (find/retrieve/explain current records) with zero database mutations outside assistant conversation/telemetry tables.

## 20. Risk Register

| Risk | Likelihood / impact | Mitigation | Owner/workstream |
|---|---|---|---|
| Cross-tenant data exposure | Medium / Critical | Server-derived org, test matrix, mandatory org predicates, delegation JWT binding | Context/security |
| Invalid workflow mutation | High / Critical | Canonical command adapters, plan/GO/revalidate, no direct DB/MCP writes | Execution framework |
| Prompt injection | High / High | Untrusted-content isolation, typed tools, egress gateway, red-team corpus | Security/research |
| PBV2/pricing regression | Medium / Critical | Reuse validators/services, inactive drafts, dedicated regression suite | Product/pricing |
| Incomplete audit/undo | High / High | Plan/tool ledger linked to domain audit; narrow reversible v1 writes | Backend platform |
| Database/report load | Medium / High | Curated queries, indexes, timeout/limits, load tests/read replica later | Reporting |
| AI hallucinated claims | High / Medium | Tool provenance/source cards, bounded claims, explicit uncertainty | Read-only tools |
| Provider/cost outage | Medium / Medium | Quotas, circuit breakers, flags, graceful no-AI behavior | AI platform |
| Deployment/environment mix-up | Medium / Critical | Separate credentials/audiences/endpoints, DEV gates, promotion checklist; correct/review DEV-targeted Vercel proxy before MAIN release | MCP/platform |
| Legacy unscoped endpoints | Confirmed / Critical | Do not tool-wrap; add dedicated tenant/security remediation and regression tests | Security/domain |
| Shop disruption | Medium / Critical | Read-only launch, feature flags, manual fallback, operator playbook | Release owner |

## 21. Open Decisions

| Decision for Batman | Options / recommendation | Tradeoff / blocker |
|---|---|---|
| Managed provider and data policy | Managed OpenAI-compatible provider vs BYOK; recommend preserve current per-org settings and approve a data-classification policy first | Cost/control vs consistency. Blocks provider-enabled MAIN use. |
| Conversation retention | 30/90 days, user deletion, or org archive policy; recommend 90-day sanitized retention with configurable legal hold | Debugging vs privacy/cost. Blocks schema finalization. |
| First write command | CRM contact update vs append-only internal quote note; recommend append-only note only after framework | Visible value vs reversibility. Does not block read-only MVP. |
| MCP server ownership/source | Keep it external integration-only vs internal tool layer; recommend external gateway only pending source audit | Reuse vs security boundary. Blocks MCP integration, not MVP. |
| Analytics capacity | Primary DB constrained reports vs replica/warehouse | Cost/latency vs operational safety. Blocks advanced reports only. |
| Permission taxonomy | Reuse roles only vs introduce named capabilities | Simplicity vs least privilege. Blocks write-tool scale-out. |
| External research sources | Approved vendor/competitor domains and consent policy | Utility vs prompt-injection/egress risk. Blocks stage 8. |

## 22. Recommended Next Prompts

1. **Foundation:** “Implement Stage 1 only: introduce feature-gated assistant contracts/tables and a backend conversation API with no domain tools or writes. Follow `docs/architecture/printershero-ai-platform-audit.md`; add new v2 migrations only; test tenant isolation.”
2. **Frontend:** “Implement the Stage 1 assistant shell in the app layout: launcher, one shared floating/docked/minimized/full-screen workspace state, local user+org layout preference, accessible keyboard behavior, and no business logic.”
3. **Conversation platform:** “Implement the read-only conversation/turn persistence, provider boundary, usage/audit correlation, sanitized retention policy hooks, and structured response cards. Do not add tool writes.”
4. **Context and permissions:** “Implement the versioned assistant context envelope and tool policy registry. Server-derive organization/user/permissions and add cross-tenant, stale-context, and unauthorized-tool tests.”
5. **MCP gateway:** “Audit the separate MCP repository and implement only an authenticated backend-to-MCP gateway contract with environment-bound delegation tokens. Do not expose core business writes through MCP.”
6. **Read-only tools:** “Add bounded, tenant-scoped read-only adapters for global search, customer, order, product, and operational summary; return source links and freshness. Do not call repositories/SQL from model code.”
7. **Reporting:** “Implement three curated tenant-scoped reports (material purchasers, overdue invoices, artwork blockers) with fixed typed inputs, budgets, provenance, and no generated SQL.”
8. **Confirmation:** “Implement execution plans, previews, one-time confirmation tokens, revalidation, idempotency records, partial-failure handling, and audit links, but wire no mutating business tool until reviewed.”
9. **Product management:** “Integrate Product Management skill with existing Product Intake/PBV2 workflow: conversationally collect structured intake, create only inactive drafts through existing services, open existing review UI, and preserve all pricing/PBV2 validation gates.”

---

### Audit validation completed

- Static repository inventory and package/deployment configuration inspection (`package.json`, `README.md`, `vercel.json`).
- Inspected tenant context, AI settings/provider routes/services/contracts, migration history, search/operational-summary routes, preference/layout patterns, and relevant schema/storage references.
- Searched the workspace for AI, MCP, product-intake, persistence, idempotency, audit, reporting, and frontend layout code.
- No typecheck, test suite, migration, seed, deployment, production/DEV request, commit, or application-code change was run.
