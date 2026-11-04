# Conversational Order restoration and capability coverage

## Historical findings

The earlier capability was real, not just chat persistence:

- `3a86375ba67193ee7737fde65e52b4804a13eb88` introduced `OrderIntakeService.respond`, persistent intake sessions, server pricing, deferred production and confirmed `orders.create`/Quote conversion commands. Creation used the normal storage Order service.
- Subsequent PBV2 selection, continuation and proposal fingerprint changes remain in the current intake service.
- `d5bf18c070d8783186e7bca9c5d65a20da30adf6` changed ordinary `createTurn` from planner/specialist dispatch to the Operator Runtime. The old specialist path still calls `orderIntakeService.respond`, but ordinary free text no longer reaches it. Its initial semantic tool list exposed Product intent, without an equivalent conversational Order adapter.
- `c585383eddc011b754c524f1bb0b740959513d6d` moved intake execution to the shared canonical Order facade.
- `283aa26fd` and `f6ab760c3511fcb502350dcd2835e5169c797061` supplied attachment preparation and discoverable GO-bound operations. The normal Operator exposed PO preparation, leaving conversation-only preparation disconnected.
- AI modernization `6bf8e3b39ca9785ee40f4b9dbce70b105c4df814` changed provider/document foundations; its AssistantService diff only changed web-tool selection. It did not delete conversational intake.

Restoration reconnects this existing service through permission-filtered semantic tools. It does not restore the old phrase-routing planner or introduce another Order writer, document parser or MCP layer. The original GO commands remain the sole execution path.

## Current path

Authorized conversation / inspected documents or images / supplied email evidence
→ existing catalog and CRM reads
→ `orders.inspect_configuration`, `orders.inspect_preparation`, `orders.prepare_create`
→ existing intake sessions and active PBV2 pricing
→ existing review cards and GO execution plan
→ `canonicalOrderOperations.createInTransaction`
→ canonical Order, linked draft Invoice, session completion and audit in one transaction
→ fresh persisted Order readback and link.

PO attachments retain their existing verified extraction adapter and duplicate checks. It produces the same intake/session/validation/execution model and can be inspected and corrected by the source-independent adapter. Source provenance stays in the intake. Inbound review/conversion remains its existing evidence-guarded workflow; this release does not replace it with Assistant creation.

## Coverage against ordinary manual entry

| Capability | AI preparation | Approved execution / limitation |
|---|---|---|
| Tenant Customer / linked Contact | Supported via canonical reads and validated IDs; clarification for ambiguity | Canonical relationship normalization; mismatched/cross-tenant identities rejected |
| Active product and multi-line entry | Supported; catalog names/specifications investigated before selecting IDs | Same active PBV2 tree and pricing service; no hardcoded product/customer exceptions |
| Finished size / quantity / fixed physical dimensions | Supported; missing required dimensions clarified | Selected active configuration governs; no hidden 1×1 dimensions |
| Sides, material, thickness, finishing and other PBV2 selections | Supported through configuration keys and existing text resolver | Canonical pricing/rules; only actual configured defaults accepted; missing choices use existing structured option card, now line-specific |
| Follow-up corrections / add / remove line | Supported through version-bound patches; untouched intent retained | Stale corrections/GO rejected; pending work cannot silently be replaced by a fresh session |
| Structural changes to an already-priced PO | Requires source re-preparation when adding/removing lines | Existing price references cannot be shifted to another item; replacing a PO-priced product requires a newly authorized total/reason |
| PO / Job Label / internal notes / production notes / priority | Supported through staff schema allowlist | Persisted by normal Order creation |
| Date-only / EOD / specific-time deadline | Supported through canonical deadline contract and organization timezone | Requested and accepted remain distinct; ambiguous relative dates require clarification |
| Pickup / ship / deliver; structured destination / shipping instructions | Supported | Same canonical create payload; customer address must first be read, never guessed |
| PO amount | Reference-only separate cents field and preview | Recorded as evidence; never implicitly changes selling price |
| Exact line-total override / Order discount | Explicit staff request and reason; existing Owner/Admin pricing authority | Canonical effective pricing and discount/tax calculation, rechecked at GO |
| Customer tax exemptions and configured tax rates | Automatic canonical calculation | Preserved; transaction-level custom tax policy adapter not included |
| Customer tier / default discount, margin or markup modifiers | Blocked by shared automatic-pricing limitation | Fail closed and identify configured fields; no claim of normal account pricing parity |
| Blind shipping / shipping-rate selection and charge acceptance | Missing narrow preparation adapter | Remains in manual canonical editor; unknown fields rejected rather than silently discarded |
| Artwork later / missing artwork | Supported for deferred Order entry | No production release; normal Prepress/artwork gates remain |
| Existing/new uploaded artwork assignment, side/quantity allocations | Missing source-independent staging-to-artwork adapter | Assistant document attachments are not automatically approved artwork. Existing manual/inbound canonical artwork operations remain available; no file duplication or quarantine bypass added |
| External artwork links | Can retain supplied link in review notes | Does not claim bytes were retrieved; no automatic download/assignment |
| Quote conversion / limited editable Order update | Existing protected commands retained | Broader existing-Order editing remains outside this preparation adapter |
| Production routing, release, shipments, payment posting | Intentionally not part of creation | Separate canonical authorized actions; never performed by preparation |

This is a restoration plus a bounded extension, **not full manual-editor parity**. Missing artwork staging, blind-shipping, tax-policy and account-pricing capabilities are explicit limitations; unavailable fields fail closed. No additional backend persistence path was created for them.

## Reliability and safety

- All supplied business fields are validated from allowlists over `insertOrderSchema` and `insertOrderLineItemSchema`; server prices, snapshots, lifecycle state, tenant and approvals cannot be model supplied.
- Proposal corrections use the same actor/conversation session and a stable JSONB-order-independent intake token. Tokens preserve explicit clears and line order. Old option questions remain stale after correction.
- Existing selections are preserved when quantities/notes change; product switches discard the old product's size/options. Explicit option corrections supersede earlier option text.
- Every direct creation now uses the already-established transactional PO pattern. Session row and current customer/contact/product/tree/tax records are pinned during final revalidation. PO locks prevent competing same-PO creation. Replays return the same persisted Order.
- Creation includes the canonical linked draft Invoice. Preview text previously said no Invoice would be created; it now describes the real side effect. No payment, shipment or production release is introduced.
- The generic JSON transport previously clamped Order parsing to 4096 output tokens. Order parsing now starts at 8192 and retries a positively identified truncation once at 12288, under the original overall deadline. Other JSON features retain their previous limits. No partial response is concatenated or accepted; the normal complete schema and evidence-CAS persistence still apply.
- Invalid Operator decision diagnostics now retain only registered tool name, structural paths and issue codes before execution. No argument values, document contents, credentials or provider reasoning are retained.

## Observed failure reference and evidence limits

Support reference `eea31811-c3f6-4fcb-8186-f1bb6c923104` was supplied by the user. This environment has no configured deployed diagnostic/database/provider credentials or Railway CLI. Its exact rejected tool and argument values could not be retrieved. The routing omission and 4096-token cap are confirmed from code/history; they are not a claim that this incident's complete cause has been recovered.

Configured-provider acceptance remains outstanding. Provider transport/runtime tests use synthetic responses, including malformed tool arguments and truncation. Browser fixture API responses are mocked; PostgreSQL tests use actual disposable loopback PostgreSQL with canonical services and independent readback. Neither establishes DEV or MAIN live acceptance.

## Focused validation artifacts

- Server: preparation, Operator service wiring/runtime, active PBV2 selections/continuation, attachment preparation, GO preview, provider transport and inbound parsing tests.
- PostgreSQL: `assistantOrderPreparation.postgres.integration.ts` covers creation/linked Invoice, multi-line correction, fixed 24×18 size, quantity 28/exact $165, requested EOD, incomplete work recovery, tenant/contact isolation, stale product/GO, duplicate PO, concurrent GO/retries, transactional rollback and line-specific option clarification.
- UI: existing option/GO component tests and `e2e/local-conversational-orders/check.mjs`, normal zoom, light/dark, synthetic API. It verifies the actual components, line-specific selection payload and exact total presentation, not live persistence.
- Scoped TypeScript uses an 8192 MB heap and reports existing baseline diagnostics separately. No full-codebase TypeScript or broad suite is required.

Existing diagnostics-panel tests and a Product failure-reporting test fail identically against HEAD; these are tracked validation limitations, not repaired in this Order-entry change. Release reporting must distinguish them from passing focused Order checks.

Final local results: 225 focused server tests, one actual Assistant-service wiring test, one HTTP option-selection route test, 18 focused UI tests and 10 real PostgreSQL tests passed (255 total). Browser fixture passed with actual option/GO components and mocked API persistence. Scoped TypeScript covered 21 changed/new TypeScript files with zero introduced diagnostics; 120 existing diagnostics remain in those roots (mainly older test typing). Five diagnostics-panel tests, one configurable-Product wording test and one Product failure-reference test were separately reproduced against HEAD and left outside this fix.

## Long-message follow-up: input rejection before the provider

The short-versus-long comparison revealed a separate input/persistence defect, independent of output-token budgets. New Operator tasks store the complete user request as `goal`, but migration 0162 and the Drizzle schema limited that field to `varchar(2000)`. The turn API accepted 8,000 characters, so a valid 2,001–8,000-character request could fail in task creation with PostgreSQL `22001` before any provider decision. The old route returned generic HTTP 500 `turn_failed`. Chat-message content itself is PostgreSQL `text`.

The isolated PostgreSQL regression temporarily restores the original 2,000-character goal limit in disposable test data and reproduces `22001`, zero provider calls, and no persisted turn. Migration **0251_assistant_order_message_capacity** widens only `goal` to 32,000 characters, matching the established message/readback contract. Historical migrations remain unchanged. Working summaries remain separately bounded at 2,000 characters.

The composer and turn schema now share the existing 32,000-character limit. Native `maxLength` was removed because it silently clips ordinary pasted text. Oversize text stays in the composer with an accessible error and disabled send; both the API builder and server schema reject it explicitly. Leading/trailing whitespace, internal line breaks, filenames and attachment references are preserved. Attachment count/type/security limits are unchanged; filename entries in message text do not count as uploaded attachments.

The global Express JSON limit remains **2,800,299 bytes** (the existing invoice-logo allowance). It is not raised. Input diagnostics record correlation ID, character count, actual raw JSON byte count when available, attachment count and stage, never Order text or filenames. Task persistence failures return a sanitized HTTP 503 `task_persistence_failed`, identify that AI processing has not begun, and retain the client draft/attachments. Raw Drizzle SQL parameters are not forwarded or logged through that failure path.

Measured synthetic fixtures (not the unavailable original MotoGFX message):

| Lines | Message characters | Serialized request bytes | Persistence |
| --- | ---: | ---: | --- |
| 1 | 898 | 1,175 | actual isolated PostgreSQL |
| 13 | 4,027 | 4,352 | actual isolated PostgreSQL |
| 100 | 26,824 | 27,497 | actual isolated PostgreSQL |

The fixed service passes each complete message to a deterministic provider fixture and independently reads back the exact task goal and user message. It also tests the 32,000-character boundary, oversize rejection, tenant scoping and idempotent retry. No Order, Invoice or shipment is created. HTTP tests exercise the real bounded Express JSON parser and route, with a mocked service; browser checks exercise the real composer with mocked failure persistence, full input retention, attachment references, oversize recovery, normal zoom and light/dark themes.

The original long MotoGFX text, deployed HTTP response and configured-provider execution remain unavailable. Therefore these results establish a reproduced pre-provider storage defect and local correction, not the precise original payload size or live incident confirmation. Deployment must apply migration 0251 before long-message task creation succeeds. No production records, provider settings, workers or MAIN are changed by this follow-up.

Follow-up validation: 22 HTTP route tests, 14 composer/workspace tests, and five real PostgreSQL tests passed (41 total). Scoped TypeScript checked 14 changed/new TypeScript roots with the 8192 MB heap: zero introduced diagnostics, seven pre-existing diagnostics remain. Migration journal/integrity checks and canonical isolated migration application passed. Browser normal-zoom light/dark checks passed using mocked HTTP failure persistence; actual configured-provider, DEV and MAIN acceptance remain outstanding.
