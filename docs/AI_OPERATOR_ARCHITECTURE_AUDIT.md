# AI Operator architecture audit

Audit date: 2026-08-09.  This document is based on current call sites, not
only historical notes.  The ordinary free-text entrypoint is
`AssistantService.createTurn`; it calls `createOperatorTurn` directly.
`createAiFirstTurn` has no call site and is a dead/redundant compatibility
candidate, not the live route.

## Current live map

```text
authenticated request
  -> AssistantService.createTurn
  -> AssistantService.createOperatorTurn
       -> durable Operator task / reduced trusted observations
       -> provider capability selection (native DeepSeek web OR fallback web tools)
       -> AssistantOperatorRuntime (bounded multi-step model loop)
       -> read registry + reviewed semantic planning tools
       -> observations/cards/task context

protected mutation
  -> semantic planning tool
  -> preview / persisted plan
  -> authoritative GO confirmation
  -> execution command revalidates permission, fingerprint/CAS, state
  -> transactional domain writer + audit/idempotency

new Product Builder request
  -> products.manage_intent
  -> initial ProductIntentCompiler (temporary AI-facing initial-intent path)
  -> CanonicalProductIntentService validation/reference resolution
  -> canonical intent session/revision
  -> GO command -> PBV2 projection -> transactional inactive product draft

active Product Builder correction (new path)
  -> products.apply_operations
  -> CanonicalProductIntentService.applySemanticOperations
  -> load current scoped draft + semantic label resolution
  -> server-built canonical patch + canonical/PBV2-compatible validation
  -> CAS revision persistence + audit diagnostics
```

The provider adapter (`operatorDecisionProvider.ts` and
`configuredProvider.ts`) is transport-only.  DeepSeek V4-Flash Responses
retains in-memory continuation items for one run, supports native web search,
and turns server function calls into ordinary Operator observations.  The
server-owned `web.search` / `web.open` tools remain fallback-only when the
provider lacks native research.

## Decisions by layer

| Component | Reachable | Classification | Decision | Reason / migration risk |
|---|---|---|---|---|
| Session-derived organization and actor scope | Live | KEEP: authorization/security | Keep | The model never supplies tenant or identity. |
| Tool registry and permission checks | Live for reads | KEEP: authorization/security | Keep | Required at every data access. |
| Command registry, preview, GO, idempotency, CAS, audit | Live for writes | KEEP: business integrity | Keep | This is the correct mutation boundary. |
| Operator Runtime and durable task context | Live | KEEP / REFACTOR incrementally | Keep | It gives the model iterative tool choice without deterministic conversation routing. |
| Provider adapters/control-protocol parsing | Live | KEEP: deterministic translation | Keep, contain | Necessary transport normalization; never expose control JSON to chat. |
| Native DeepSeek public web and fallback research tools | Live/fallback | KEEP: capability selection | Keep | It is a provider capability decision, not a business router. |
| Declarative analysis workspace | Live | KEEP: business integrity | Keep | It operates only on released observations and has no ambient code/SQL/network access. |
| Canonical Product Intent and PBV2 projection/writer | Live | KEEP: authoritative-state validation | Keep below semantic boundary | They own canonical state, pricing compatibility, transactionality, and persistence. |
| ProductIntentCompiler initial create contract | Live | REFACTOR | Retain temporarily for initial broad natural-language construction | It still makes the model produce a large intent-shaped object. Replace incrementally with semantic creation operations or a server-built draft scaffold. |
| ProductIntentCompiler continuation/repair/normalization | Live fallback | BYPASS for Operator semantic corrections | Contain as compatibility path | It duplicates Operator interpretation and caused repair/persistence-stage failures. |
| `products.apply_operations` | Live for active canonical tasks | KEEP: deterministic semantic translation | New primary correction path | The model supplies only small business operations; server owns all canonical/persistence structures. |
| Product management legacy intake/batch/pricing parsers | Reachable from legacy planner/specialist route | LEGACY-CONTAIN | Do not expand | Existing callers may rely on them; move future calls to semantic capabilities. |
| AI-first typed planner / capability catalog | `createAiFirstTurn` has no current caller | DEAD / candidate removal | Do not route ordinary chat through it | It is a second model-routing layer plus specialist dispatch; preserve only until its explicit callers/tests are retired. |
| Quote/order/CRM/production/fulfillment/billing/payment specialist services | Reachable only behind legacy AI-first dispatch/structured routes | LEGACY-CONTAIN | Keep business writers, migrate AI entrypoints later | Their command/GO writers are valuable; their message parsing/intake adapters should become semantic planning tools. |
| Inbound email/order classifiers | Live outside Operator | NEEDS FURTHER EVIDENCE | Do not refactor in this slice | Repository contains phrase/rule classification and intake persistence. Treat as the next architecture audit target after Product Builder. |

## Rules-first boxes still present

1. `ProductIntentCompiler` initial creation still combines a provider schema,
   repair prompt, normalization, and canonical result contract.  This is the
   largest remaining AI-facing interpreter.
2. `CanonicalProductIntentService.continue` still uses deterministic answer
   matching and then a provider continuation compiler when no exact answer is
   found.  It is retained only for compatibility after this change.
3. `createAiFirstTurn` has a planner-selected specialist switch for product,
   quote, order, CRM, production, fulfillment, billing, and payment domains.
   It is currently uncalled by ordinary free text.
4. Legacy product intake and other domain services include message parsers and
   workflow-specific intake state.  These should be adapters around domain
   capabilities, not future Operator routing requirements.
5. Inbound email ingestion contains deterministic phrase/classification rules.
   Some are legitimate intake safety/triage; whether they duplicate business
   interpretation needs a separate evidence-led review.

## Product Builder decision and target boundary

Decision: **keep Canonical Product Intent and PBV2 as server-owned state;
drastically reduce the Product Intent compiler's AI-facing role; bypass it
for active semantic corrections.**  The compiler is not the primary
correction interface any more.

The first semantic interface is deliberately small and composable:

- product name, category, proof requirement, pricing basis
- matrix rate by displayed option group/value
- option default and safe option/value removal

It does not expose a `ProductDraftPatch`, `serverOwnedFields`, entity IDs,
proposal IDs, revisions, fingerprints, persistence metadata, or PBV2 trees.
The server resolves labels, loads the current revision, builds the canonical
patch, validates authoritative relationships, derives state, and persists a
new revision with compare-and-swap.

The next additions should be general operations, not product-specific
commands: option-group add/update, option-value add/update, price-impact and
dependency mutation, measurement/quantity requirements, and scalar pricing.
They will allow a server-created blank canonical draft to be assembled
incrementally, removing the remaining initial `complete_intent` provider
contract without a second product engine.

## Workflow review

| Workflow | Current behavior | Direction |
|---|---|---|
| Informational / internal lookup | Operator chooses read tools; registry validates args, scope, permission and result | Keep. |
| Public research | Operator uses native provider research or fallback tools; no GO | Keep private-data disclosure guard. |
| Reporting / analysis | Operator uses released observations and bounded analysis DSL | Keep generic; do not turn into report routers. |
| Product creation | Initial compiler -> canonical session -> GO -> PBV2 draft | Migrate initial interpretation to semantic creation operations gradually. |
| Product correction | Previously continuation compiler -> repair -> patch | New direct semantic operation -> server translation -> CAS revision. |
| Quote/order/CRM | Legacy specialist intake -> plan/GO command | Replace AI-facing intake/parser layers with small semantic planning capabilities; keep command writers. |
| Production/fulfillment/invoices/payments | Legacy specialist operations -> plan/GO command | Same migration pattern, with extra fulfillment and financial integrity checks retained. |
| Inbound Orders | Inbound ingestion/evidence/rule pipeline, not yet an Operator semantic capability | Audit next; do not refactor before Product Builder proof is validated. |

## Migration order

1. Observe and validate the new Product Builder semantic correction path.
2. Add general semantic creation operations and a server-created draft
   scaffold; then retire initial provider `complete_intent` output.
3. Remove the now-unused AI-first planner path after explicit caller and
   deployment evidence confirm no dependency.
4. Migrate quote/order/CRM planning to semantic capability adapters while
   retaining their GO command writers.
5. Migrate production/fulfillment/billing/payments, preserving their domain
   integrity checks.
6. Audit Inbound Orders separately for which classifiers are safety/triage vs.
   duplicated interpretation.
