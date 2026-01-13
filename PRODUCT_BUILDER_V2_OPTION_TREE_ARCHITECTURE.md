# Product Builder v2 — Option Tree Architecture (TitanOS / QuoteVaultPro)

> Purpose: Define a production-safe, auditable Option Tree v2 architecture that supports multi-branch conditional flows, computed values, default-on derived pricing, and soft-delete — without requiring hand-authored JSON for common products.

---

## 1) Core Entities (v2)

```text
ProductOptionTreeV2 (versioned container)
- Owns the graph for a product (or product+variant scope)
- Provides lifecycle + versioning so historical line items remain evaluable

OptionNodeV2 (typed node)
- Represents inputs, computed values, pricing, and effects
- Nodes are stable IDs; semantics evolve via versioning, not mutation-in-place

OptionEdgeV2 (conditional edge)
- Enables multi-branch flows: one node can route to many children based on conditions

OptionValueDefinition (input contract)
- Defines how an input node accepts values (enum choices, number w/ units, boolean, etc.)
- Drives editor UI + validation

ComputedExpression (pure computation)
- Defines derived values (counts, overages, derived quantities)
- Deterministic and side-effect-free

PricingRule / PriceComponent
- Defines pricing contributions (flat, per-unit, per-overage, tiered, clamps)
- References computed outputs and/or inputs

Effect / OutputArtifact
- Produces downstream production facts (grommetCount, finishing ops list, etc.)

LineItemSelectionsV2 (canonical user selections)
- Stores only what the user explicitly chose/entered + references to treeVersionId
- Never stores derived defaults as if user picked them

PricingSnapshot (immutable)
- Stores evaluated results used for quote/order/invoice totals at time of pricing
- Must remain valid even if product option tree changes later

EvaluationTrace (optional but valuable)
- Captures how engine arrived at values (node outputs, conditions taken)
- Supports audit + debug

SoftDelete semantics
- Any node/edge/value def can be soft-deleted with restore
- Prevents orphaned references and preserves historical evaluation
```

---

## 2) States and Valid Transitions

### 2.1 ProductOptionTreeV2 lifecycle

```text
TreeStatus:
- DRAFT
- ACTIVE
- DEPRECATED (still evaluable for existing line items, not selectable for new ones)
- ARCHIVED (read-only, evaluable only for historical)

Transitions:
- DRAFT -> ACTIVE        (publish)
- ACTIVE -> DEPRECATED   (superseded by new ACTIVE version)
- DEPRECATED -> ARCHIVED (optional, policy-driven)

Disallowed:
- ACTIVE -> DRAFT (instead clone ACTIVE into a new DRAFT version)
```

### 2.2 Node/Edge lifecycle within a tree version

```text
EntityStatus (Node/Edge/ValueDef/Rule):
- ENABLED
- DISABLED (temporary off; keeps references intact; evaluation skips)
- DELETED  (soft-delete; hidden in editor; historical evaluation remains valid)

Transitions:
- ENABLED <-> DISABLED
- ENABLED -> DELETED
- DISABLED -> DELETED
- DELETED -> ENABLED (restore; requires validation)
```

### 2.3 Editor session states

```text
EditorSessionState:
- idle
- editing
- validating
- saving_draft
- published

Rules:
- Draft edits must not affect ACTIVE evaluation.
- Publishing requires passing server-side validation.
```

---

## 3) TEMP → PERMANENT Boundaries

```text
TEMP (safe to iterate, cannot affect production):
- Editor local state (graph edits, node reorder, incomplete wiring)
- Draft tree versions
- Validation warnings/errors
- Preview evaluations (what-if pricing) not used to finalize quotes/orders

PERMANENT (production-impacting, auditable):
- Published ACTIVE tree versions (immutable)
- LineItemSelectionsV2 referencing a specific treeVersionId
- PricingSnapshot attached to quote/order/invoice records
- Audit events for publish/deprecate/restore actions

Hard boundary:
- A line item MUST reference an immutable treeVersionId.
- No line item may reference a mutable draft graph.
```

---

## 4) Rejections (non-negotiable)

```text
Rejected approaches:
1) One JSON blob per product edited by hand
   - Violates “no manual JSON for common products”, validation, auditability

2) Mutate active tree in place
   - Breaks historical evaluation for existing orders/invoices

3) Hard delete nodes/options
   - Creates orphaned references for saved line items

4) Store defaults as if user selected them
   - Breaks auditability and causes summary mismatches

5) Single linear chain model
   - Cannot express conditional multi-branch flows
```

---

## A) Option Tree v2 Schema Specification (conceptual)

```text
ProductOptionTreeV2
- id
- organizationId
- productId
- variantScopeId? (nullable)
- version (int, monotonic per product scope)
- status: DRAFT|ACTIVE|DEPRECATED|ARCHIVED
- createdAt, createdByUserId
- publishedAt?, publishedByUserId?
- deprecatedAt?, deprecatedByUserId?
- clonedFromTreeId? (lineage)

OptionNodeV2
- id
- treeId
- status: ENABLED|DISABLED|DELETED
- type: INPUT|COMPUTE|PRICE|EFFECT|GROUP
- key (stable semantic key, e.g. "finishing.grommets.enabled")
- label
- description?
- data (typed by node.type)
- sortOrder (editor convenience)
- createdAt, updatedAt, deletedAt?

OptionEdgeV2
- id
- treeId
- fromNodeId
- toNodeId
- status
- condition (ConditionRule AST)
- priority (evaluation order when multiple edges match)
- createdAt, deletedAt?

ConditionRule (structured; not free-form code)
- op: AND|OR|NOT|EQ|NEQ|GT|GTE|LT|LTE|IN|EXISTS
- left/right: Ref or constant
- recursive for AND/OR/NOT
- refs must be resolvable + type-compatible
```

### Node type payloads

```text
1) INPUT node (data)
- inputKind: BOOLEAN | ENUM | NUMBER | TEXT
- defaultMode:
   - NONE
   - STATIC (value)
   - COMPUTED (ref to compute node output)
- constraints:
   - required? boolean
   - number: min/max/step/unit
   - enum: options [{ value, label, status, sortOrder }]
- selectionKey (canonical key stored in LineItemSelectionsV2)

2) COMPUTE node (data)
- outputType: NUMBER|BOOLEAN|TEXT|JSON
- expression: ExpressionSpec (pure AST)

3) PRICE node (data)
- components: PriceComponent[]
- roundingMode?
- currency

PriceComponent
- kind: FLAT | PER_UNIT | PER_OVERAGE | TIERED
- quantityRef (required for per_* kinds)
- unitPriceRef (ref or constant; prefer pricebookRef)
- overageBaseRef (for PER_OVERAGE)
- minCharge/maxCharge?
- appliesWhen?: ConditionRule

4) EFFECT node (data)
- outputs: [{ key, valueRef, unit?, visibility: internal|customer? }]

5) GROUP node (data)
- organizational; no runtime effect
```

### Default handling (explicit)

```text
Default-on behavior must be represented as:
- INPUT defaultMode=STATIC true (for boolean default-on)

But LineItemSelectionsV2 stores:
- explicit selections only

Evaluation:
- effectiveValue = explicitSelection ?? defaultValue

This preserves auditability without pretending user chose defaults.
```

### Deletion semantics

```text
- No hard deletes for anything that may be referenced.
- DELETED entities are hidden by default but remain in immutable historical versions.
- Restore requires validation pass (no key collisions, graph validity).
```

---

## B) Editor behavior rules

```text
1) Adding nodes
- Allowed only in DRAFT versions
- Must set: key, label, type, type data

2) Multi-branch linking
- Allow N outgoing edges per node
- Edge has condition + priority

3) Deleting/restoring nodes
- Delete = status=DELETED (soft)
- Connected edges become DISABLED or DELETED by policy (recommend DISABLED)
- Restore re-enables and triggers validation

4) Validation rules and error surfacing
- Hard errors (block publish):
  - missing root
  - invalid expressions
  - dangling refs
  - cycle
  - unreachable required inputs
  - invalid price refs
- Warnings (allow publish):
  - unreachable non-required nodes
  - redundant/overlapping conditions
  - default value violates constraints
```

---

## C) Downstream integration (storage, evaluation, invoice snapshotting)

### C.1 Canonical vs derived storage

```text
Canonical (persisted with line item):
- treeVersionId
- selectionsV2: map(selectionKey -> explicitValue)
- (optional) selectionMetaV2

Derived (not canonical):
- effectiveInputs
- computedOutputs
- pricing breakdown
- effects / production facts

Derived data may be persisted only inside immutable PricingSnapshot/EvaluationTrace.
```

### C.2 Evaluation order

```text
1) Load treeVersionId (immutable)
2) Resolve effective inputs (explicit ?? default)
3) Evaluate compute nodes in dependency order (topological sort)
4) Evaluate price nodes (condition-gated), accumulate components
5) Emit effects for production
6) Produce PricingSnapshot (+ optional EvaluationTrace)
```

### C.3 Invoice snapshotting

```text
On finalization (quote/order/invoice):
- persist PricingSnapshot referencing:
  - productId
  - treeVersionId
  - selectionsV2 (canonical)
  - computed outputs (frozen)
  - price breakdown (frozen)
  - totals (frozen)

Invoices must never depend on re-evaluating a mutable definition.
```

---

## D) Banner finishing example (FULL model)

```text
Goal:
- Grommets default ON
- Spacing default 24"
- Compute standard vs requested grommet count
- Overage pricing

Nodes:
N1 INPUT  key=finishing.grommets.enabled
- inputKind=BOOLEAN
- defaultMode=STATIC true
- selectionKey=grommetsEnabled

N2 INPUT  key=finishing.grommets.spacingInches
- inputKind=NUMBER
- defaultMode=STATIC 24
- constraints min=6 max=48 unit=in
- selectionKey=grommetSpacingIn

N3 INPUT  key=finishing.grommets.requestedCount
- inputKind=NUMBER
- defaultMode=NONE
- constraints min=0 unit=count
- selectionKey=grommetRequestedCount

N4 COMPUTE key=finishing.banner.perimeterInches
- expression: 2*(widthIn + heightIn)

N5 COMPUTE key=finishing.grommets.standardCount
- expression:
   if grommetsEnabled==false -> 0
   else max(4, ceil(perimeterInches / grommetSpacingIn))

N6 COMPUTE key=finishing.grommets.effectiveCount
- expression:
   if grommetsEnabled==false -> 0
   else if exists(requestedCount) -> requestedCount
   else standardCount

N7 COMPUTE key=finishing.grommets.overageCount
- expression: max(0, effectiveCount - standardCount)

N8 PRICE key=pricing.finishing.grommets.overage
- components:
   - kind=PER_UNIT
   - quantityRef = ref(nodeOutput finishing.grommets.overageCount)
   - unitPriceRef = ref(pricebook finishing.grommets.overageUnitPrice)
- appliesWhen: grommetsEnabled==true

N9 EFFECT key=effect.production.finishing
- outputs:
   - grommetsEnabled
   - grommetSpacingIn
   - grommetStandardCount
   - grommetRequestedCount
   - grommetEffectiveCount
   - grommetOverageCount

Edges (multi-branch):
- Root -> N1 (always)
- N1 -> N2 (grommetsEnabled==true)
- N1 -> N3 (grommetsEnabled==true)
- N2 -> N5 (grommetsEnabled==true)
- N3 -> N6 (grommetsEnabled==true)
- N5 -> N6 (grommetsEnabled==true)
- N6 -> N7 (grommetsEnabled==true)
- N7 -> N8 (overageCount > 0)
- N6 -> N9 (always)

Key integrity outcome:
- requestedCount remains null unless user sets it
- defaults apply without being stored as explicit selections
- overage pricing is expressed cleanly via compute + price nodes
```

---

## E) Migration and rollout strategy (v1 and v2 coexist)

```text
Phase 0 — Introduce v2 alongside v1 (no behavior change)
- Keep v1 options untouched
- Add product capability: activeTreeVersionId? (nullable)
- Pricing chooses:
  - if line item references treeVersionId -> v2
  - else -> v1

Phase 1 — Tooling parity
- Editor supports: create draft, add nodes/edges, soft-delete/restore, validate, publish
- Runtime evaluation + snapshotting for v2
- Audit logs for publish/deprecate/restore

Phase 2 — Controlled adoption
- New products opt into v2
- Existing products remain v1 until migrated
- Optional v1->v2 importer only if it produces valid trees without manual JSON

Phase 3 — Deprecate v1 editor path
- Keep v1 evaluation for historical artifacts indefinitely
- Stop creating new v1 products once v2 coverage is sufficient

Backward compatibility guarantees
- Existing products unaffected unless opted into v2
- Existing orders/invoices remain correct via snapshots / pinned tree versions
```

---

## Appendix 1 — Validation spec (publish gate)

```text
Validation runs:
- Draft validation (editor, continuous)
- Publish validation (server, authoritative)

Severities:
- ERROR blocks publish
- WARNING allows publish

Graph structural (ERROR):
- referential integrity for nodes/edges
- root exists
- required INPUT nodes reachable
- no cycles

Type system (ERROR):
- INPUT: selectionKey present + unique, constraints valid
- COMPUTE: expression parses, types match, refs resolvable
- PRICE: qty refs and unit price refs resolvable + typed
- EFFECT: output refs resolvable

Semantics:
- key collisions (ERROR)
- ambiguous branching (WARNING/ERROR by policy)

Publish requirements:
- no ERROR validations
- publishing locks tree version immutably
```

---

## Appendix 2 — ExpressionSpec (AST) and ConditionRule

```text
ExpressionSpec (safe AST)
- literals: number/boolean/string/null
- refs: selectionRef, effectiveRef, nodeOutputRef, envRef, pricebookRef
- arithmetic: add/sub/mul/div
- comparisons: eq/neq/gt/gte/lt/lte/in
- logical: and/or/not
- conditional: if(cond, then, else)
- numeric helpers: min/max/ceil/floor/round/clamp
- existence: exists(x), coalesce(a,b,...)

Typing rules:
- no implicit string<->number coercion
- refs must be type-compatible
- div-by-zero must be guarded or fails evaluation (publish may warn if not provably safe)

ConditionRule AST
- AND/OR/NOT + comparison ops + EXISTS
- built by editor, validated by server
- no free-form code
```

---

## Appendix 3 — Ref Contract (stable wiring API)

```text
Allowed ref types:
- selectionRef: explicit only (no defaults)
- effectiveRef: explicit ?? default
- nodeOutputRef
- envRef (engine-provided keys like widthIn/heightIn/quantity/sqft)
- constant
- pricebookRef (tenant/product scoped constants, avoids hardcoded pricing)

Currency policy recommendation:
- compute price in integer cents internally
- snapshot stores authoritative cents totals (and optional decimal for display)
```

---

## Appendix 4 — Continuation prompts (verbatim)

```text
If you want the next step after this architecture: I can produce a “v2 validation spec” (the exact list of validation errors/warnings and how they’re detected) and a “ref model” for ExpressionSpec (AST operators list + typing rules).
```

```text
If you want me to continue further: I’ll next define the exact “Ref contract” (what keys are allowed, how node outputs are named), plus the minimum viable node set you need for parity with today’s v1 options (including materials-related effects and nested option groups), and the coexistence rules between v1 selectedOptions/specsJson and v2 selectionsV2 so we don’t regress the grommets/default issues we just fixed.
```

```text
If you want me to keep going, the next “architecture-only” deliverable should be one of these (your pick):
1) PricebookRef design: how keys are scoped (org/product/variant) and audited
2) Tree diffing/audit: how publishing logs a structured changelog for production traceability
3) Migration playbook: a concrete v1 banner -> v2 tree conversion plan without breaking existing line items
```

---

## Appendix 5 — Product Builder v2 Validation & Invariants Spec (Option A)

```text
Product Builder v2 — Validation & Invariants Spec (Option A)
Source baseline: PRODUCT_BUILDER_V2_OPTION_TREE_ARCHITECTURE.md

0) Purpose
Define authoritative server-side validation for Option Tree v2:
- Publish gate (DRAFT -> ACTIVE)
- Restore gate (DELETED -> ENABLED)
- Draft-save gate (optional, softer)
- Runtime-evaluation gate (treeVersionId safety + snapshot integrity)

Non-negotiable outcomes:
- No orphan references
- No in-place mutation of ACTIVE trees
- No evaluation without an immutable treeVersionId
- No hard deletes for referenced artifacts
- Deterministic, typed, side-effect-free evaluation

1) Entities, statuses, and scope rules (validation prerequisites)

1.1 Tree version immutability rules
- ACTIVE tree versions are immutable. Any change requires cloning to DRAFT.
- DEPRECATED/ARCHIVED are immutable.
- Only DRAFT can be edited.

Validation must reject any write attempt that mutates a non-DRAFT tree.

1.2 Node types
- INPUT | COMPUTE | PRICE | EFFECT | GROUP

GROUP nodes are editor-only:
- GROUP nodes must not participate in runtime evaluation.
- GROUP nodes cannot be targets/sources of runtime edges (see 2.4).
- GROUP nodes cannot be referenced by expressions or conditions.

1.3 Statuses (Node/Edge/ValueDef/Rule)
- ENABLED | DISABLED | DELETED

Status semantics:
- ENABLED: evaluated normally
- DISABLED: preserved; skipped by evaluation; may remain referenced
- DELETED: preserved; hidden by default; may remain referenced historically; cannot be newly referenced by ENABLED edges/nodes

2) Validation events and gates

2.1 Draft validation (continuous, editor feedback)
Purpose:
- Fast feedback while editing
Rules:
- May be incomplete; does not block saving DRAFT unless “hard error” category selected by policy

Outputs:
- errors[] (potential publish blockers)
- warnings[] (quality risks)
- info[] (optimization suggestions)

2.2 Publish validation (server authoritative)
Purpose:
- Block DRAFT -> ACTIVE unless graph is evaluable, deterministic, and safe
Hard rule:
- Must be repeatable and deterministic given same inputs/selections/env

Outputs:
- errors[] (publish blocked)
- warnings[] (publish allowed but logged)
Publish action must record:
- validation summary
- hash/fingerprint of tree content for audit (optional but recommended)

2.3 Restore validation (DELETED -> ENABLED)
Purpose:
- Ensure restoring a previously deleted entity does not corrupt the graph or violate uniqueness contracts
Rules:
- Restore is allowed only in DRAFT (recommended). If restore in ACTIVE is ever attempted, reject.
Outputs:
- errors[] block restore
- warnings[] allow restore with caution

2.4 Runtime evaluation validation
Purpose:
- Ensure evaluations are pinned to immutable definitions and snapshots are consistent
Hard rules:
- Evaluation requires treeVersionId (ACTIVE/DEPRECATED/ARCHIVED only; never DRAFT)
- If treeVersionId points to DRAFT, reject evaluation for persistence; allow preview only with explicit “preview mode” flag and no snapshot persistence.

3) Validation severity model

3.1 Severity
- ERROR: blocks publish/restore/evaluate (depending on gate)
- WARNING: allows proceed but must log and show in UI
- INFO: optional guidance

3.2 Validation identifiers
Each finding must include:
- code (stable string)
- message (human)
- path (JSON pointer-like: tree.nodes[nodeId].data..., tree.edges[edgeId]...)
- entityId (node/edge id if applicable)
- context (small structured fields: expectedType, actualType, refName, etc.)

4) Publish gate — required ERROR checks

4.1 Tree-level structural integrity (ERROR)

PBV2_E_TREE_STATUS_INVALID
- Tree status must be DRAFT at time of publish.

PBV2_E_TREE_NO_ROOTS
- rootNodeIds must exist and include at least one ENABLED runtime node.
- Runtime nodes exclude GROUP and DELETED.

PBV2_E_TREE_ROOT_INVALID
- Each rootNodeId must exist, belong to tree, and be ENABLED.
- Root cannot be GROUP or DELETED.
- Root cannot be DISABLED if it is the only path to required inputs (see reachability).

PBV2_E_TREE_DUPLICATE_IDS
- Node IDs unique
- Edge IDs unique

PBV2_E_TREE_KEY_COLLISION
- node.key must be unique among ENABLED + DISABLED nodes within a tree version.
- Restoring a node that collides is blocked (restore gate too).

PBV2_E_SELECTION_KEY_COLLISION
- INPUT.selectionKey must be unique among INPUT nodes (ENABLED+DISABLED) within the tree version.
- selectionKey is the persistence contract; collisions block publish.

4.2 Edge integrity (ERROR)

PBV2_E_EDGE_MISSING_ENDPOINT
- Edge fromNodeId and toNodeId must exist.

PBV2_E_EDGE_CROSS_TREE
- Edge endpoints must belong to same treeId.

PBV2_E_EDGE_STATUS_INVALID
- ENABLED edges cannot reference DELETED nodes.
- ENABLED edges cannot connect to GROUP nodes.
- If from or to node is DISABLED, ENABLED edge is allowed only if policy supports “revive later”; recommended: block and require edge to be DISABLED too.
   - Recommended rule: if either endpoint is DISABLED, edge must be DISABLED.
   - If either endpoint is DELETED, edge must not be ENABLED.

PBV2_E_EDGE_SELF_LOOP
- fromNodeId != toNodeId

PBV2_E_EDGE_INVALID_PRIORITY
- priority must be integer >= 0
- For edges with same fromNodeId, duplicate priority allowed, but then ambiguity warning required (see 5.6).

PBV2_E_EDGE_CONDITION_INVALID
- condition must parse as ConditionRule AST
- all refs must resolve and type-check (see 4.5)
- condition must not reference selectionKey of nodes that are unreachable (publish-blocking only if used for gating required nodes; otherwise warning)

4.3 Graph cycles (ERROR)

PBV2_E_GRAPH_CYCLE
- The runtime dependency graph (nodes + ENABLED edges) must be acyclic.
- Exclude GROUP nodes entirely.
- Exclude DISABLED/DELETED nodes and DISABLED edges.
- Cycle detection must run on the subgraph of runtime-visible nodes (ENABLED only).
- If cycles exist only through DISABLED nodes/edges, allow publish but warn (see 5.2).

4.4 Reachability & required inputs (ERROR)

PBV2_E_REQUIRED_INPUT_UNREACHABLE
- Any INPUT node with constraints.required=true must be reachable from at least one root via ENABLED edges under at least one satisfiable condition path.

Definition: "reachable under satisfiable conditions"
- For publish gate, we cannot solve arbitrary satisfiability fully.
- Use a conservative approach:
   - If an edge condition is obviously unsatisfiable (e.g., EQ(ref, "A") and EQ(ref, "B") with A!=B) => unsatisfiable.
   - Otherwise treat as potentially satisfiable.
- If required node has zero potentially satisfiable paths from roots => ERROR.
- If required node has only paths gated by conditions referencing itself (circular visibility) => ERROR.

PBV2_E_INPUT_MISSING_SELECTION_KEY
- INPUT must define selectionKey.

PBV2_E_INPUT_CONSTRAINT_INVALID
- For NUMBER: min <= max, step > 0, unit defined if required by UI policy.
- For ENUM: options non-empty if required, each option.value unique, no empty string values (client UI rule; still validate server-side).
- For BOOLEAN: default if provided must be boolean.

4.5 Expression system integrity (ERROR)

PBV2_E_EXPR_PARSE_FAIL
- COMPUTE.expression must parse as ExpressionSpec AST.

PBV2_E_EXPR_REF_UNRESOLVED
- Any ref must resolve:
   - selectionRef -> INPUT.selectionKey exists
   - effectiveRef -> INPUT.selectionKey exists
   - nodeOutputRef -> references a COMPUTE node outputType (or EFFECT output if allowed; recommended: EFFECT outputs are NOT ref targets)
   - envRef -> must be in allowed env set (widthIn, heightIn, quantity, sqft, etc.)
   - pricebookRef -> must be resolvable by key (org/product/variant scope policy) OR at minimum be syntactically valid with a known scope prefix

PBV2_E_EXPR_TYPE_MISMATCH
- No implicit coercion.
- Operators require type compatibility:
   - arithmetic: numbers only
   - comparisons: compatible types
   - logical: booleans only
   - if(cond, then, else): cond boolean; then/else same type
   - exists/coalesce: allowed for any type but returns boolean or chosen type per spec

PBV2_E_EXPR_COMPUTE_DEP_CYCLE
- Compute-node dependency graph (based on nodeOutputRef usage) must be acyclic.
- This is separate from edge graph cycles.
- If compute dependency cycle exists => ERROR.

PBV2_E_EXPR_DIV_BY_ZERO_UNGUARDED (policy: ERROR or WARNING)
- If ExpressionSpec includes division, require guarding if denominator can be zero.
- Conservative rule:
   - If denominator is a literal 0 => ERROR
   - If denominator is a ref with no explicit guard => WARNING (or ERROR if strict mode)
   - Guard patterns recognized:
      - if(den == 0, 0, num/den)
      - clamp(den, eps, ...) etc. per allowed helper list

4.6 PRICE node integrity (ERROR)

PBV2_E_PRICE_COMPONENT_INVALID
- Each PriceComponent must have required fields by kind:
   - FLAT: unitPriceRef/constant
   - PER_UNIT: quantityRef + unitPriceRef
   - PER_OVERAGE: quantityRef + overageBaseRef + unitPriceRef
   - TIERED: tiers present, tier bounds valid, quantityRef valid

PBV2_E_PRICE_REF_UNRESOLVED
- quantityRef must resolve to NUMBER
- unitPriceRef must resolve to NUMBER (cents or decimal policy; recommend cents)
- overageBaseRef must resolve to NUMBER

PBV2_E_PRICE_NEGATIVE_QUANTITY (policy: WARNING or ERROR)
- If quantityRef can produce negative numbers without clamp => WARNING
- If static analysis proves negative literal => ERROR

PBV2_E_PRICE_SIDE_EFFECT_ATTEMPT
- PRICE nodes must not write selections or outputs; only emit components.
- In practice: schema disallows write primitives; validate no forbidden ref types or “set” ops exist.

4.7 EFFECT node integrity (ERROR)

PBV2_E_EFFECT_OUTPUT_INVALID
- Each output must have:
   - key (unique within node)
   - valueRef resolvable
- output keys must be unique and non-empty.

PBV2_E_EFFECT_REF_UNRESOLVED
- valueRef must resolve.

PBV2_E_EFFECT_REF_FORBIDDEN (policy)
- EFFECT outputs should not be referenced by COMPUTE/PRICE/CONDITION.
- Recommended: forbid nodeOutputRef to EFFECT nodes entirely.
- If any ref targets EFFECT outputs => ERROR.

4.8 Forbidden node/edge usages (ERROR)

PBV2_E_GROUP_NODE_REFERENCED
- GROUP nodes cannot:
   - be edge endpoints
   - be referenced by refs

PBV2_E_DELETED_ENTITY_NEW_REFERENCE
- ENABLED nodes/edges cannot reference DELETED nodes/edges/value defs.

5) Publish gate — WARNING checks (quality + future-proofing)

5.1 Unreachable non-required nodes (WARNING)
PBV2_W_NODE_UNREACHABLE
- Node is ENABLED but not reachable from any root via potentially satisfiable paths.

5.2 Disabled-cycle presence (WARNING)
PBV2_W_CYCLE_THROUGH_DISABLED
- Cycle exists but only through DISABLED nodes/edges.
- This suggests future restore/enable could break publish later.

5.3 Redundant / overlapping conditions (WARNING)
PBV2_W_CONDITION_OVERLAP
- Two edges from same fromNodeId can both match without deterministic tie-break.
- If priorities differ, still warn if both can match.
- If priorities same, warn stronger (see 5.6).

5.4 Dead-end required branch (WARNING)
PBV2_W_REQUIRED_BRANCH_NO_EXIT
- A required input is reachable only through a branch that leads to no PRICE/EFFECT and terminates unexpectedly.
- Not always wrong, but often indicates incomplete configuration.

5.5 Default violates constraints (WARNING or ERROR by policy)
PBV2_W_DEFAULT_OUT_OF_RANGE
- INPUT default value outside min/max.
- Recommend ERROR if required; WARNING if optional.

5.6 Ambiguous edge resolution (WARNING / ERROR by policy)
PBV2_W_EDGE_AMBIGUOUS_MATCH
- Multiple outgoing edges from the same node can match and share same priority.
- Recommended: ERROR if both can match and lead to required inputs or pricing.
- Otherwise WARNING and engine must pick deterministic order (e.g., edgeId lexical), but log it.

5.7 Pricebook ref missing (WARNING in DRAFT; ERROR in publish if strict)
PBV2_W_PRICEBOOK_REF_NOT_FOUND
- pricebookRef key is syntactically valid but not resolvable at publish time.
- Recommended policy:
   - For publish: ERROR unless the system supports “late-bound pricebook values” with guaranteed fallback.
   - If late-binding supported: WARNING + require evaluation-time hard error if missing.

6) Restore gate — required checks

Restore applies when changing DELETED -> ENABLED (or DISABLED).
Recommended: only allow restore in DRAFT trees.

6.1 Restore context (ERROR)
PBV2_E_RESTORE_NOT_IN_DRAFT
- Reject restore for non-DRAFT trees.

6.2 Uniqueness collisions (ERROR)
PBV2_E_RESTORE_KEY_COLLISION
- Restoring node.key collides with existing node.key in same tree version.

PBV2_E_RESTORE_SELECTION_KEY_COLLISION
- Restoring INPUT.selectionKey collides with existing INPUT selectionKey.

6.3 Edge consistency (ERROR)
PBV2_E_RESTORE_EDGE_TO_DELETED
- Restoring a node where its connected edges would become ENABLED but point to DELETED endpoints is blocked unless those edges remain DISABLED.

Policy recommendation:
- On restore, connected edges remain DISABLED until explicitly re-enabled by user.

6.4 Validation on restore (WARNING/ERROR)
- Run publish-level integrity checks locally on impacted subgraph.
- If restore would introduce cycles or required unreachable nodes, block restore (ERROR).

7) Runtime evaluation gate — required checks

7.1 Tree version pinning (ERROR)
PBV2_E_EVAL_MISSING_TREE_VERSION
- Any persisted evaluation requires treeVersionId.

PBV2_E_EVAL_TREE_VERSION_STATUS_INVALID
- treeVersionId must reference ACTIVE/DEPRECATED/ARCHIVED.
- If DRAFT: allow only preview mode; do not persist snapshots.

7.2 Snapshot contract (ERROR)
PBV2_E_SNAPSHOT_MISSING_FIELDS
- PricingSnapshot must store:
   - productId
   - treeVersionId
   - selectionsV2 (explicit)
   - effectiveInputs (optional but recommended)
   - computedOutputs (optional but recommended)
   - breakdown components
   - totals in cents (authoritative)

7.3 Selection validation at evaluation (ERROR)
PBV2_E_SELECTION_INVALID_TYPE
- User-provided selections must type-check against INPUT definitions.

PBV2_E_SELECTION_ENUM_INVALID
- Enum selection must be one of allowed enabled options.

PBV2_E_SELECTION_NUMBER_OUT_OF_RANGE (policy)
- If out of range:
   - In quote editor: treat as ERROR and block saving/pricing
   - In historical evaluation: clamp or error? Recommended: error and show “invalid selection in historical record” because it indicates data corruption.

7.4 Evaluation determinism (ERROR)
PBV2_E_EVAL_NONDETERMINISTIC_EDGE
- If multiple edges match with same priority and engine tie-break relies on non-stable iteration order, reject.
- Engine must define stable ordering (priority, then edgeId asc), and still log ambiguity warning.

8) Implementation notes (how to detect key conditions without solving SAT)

8.1 “Potentially satisfiable path” heuristic
- Treat each edge condition as:
   - UNSAT if it contains provable contradictions within the AST:
      - AND(EQ(x,a), EQ(x,b)) where a != b
      - AND(GT(x,10), LT(x,5))
      - IN(x, []) etc.
   - UNKNOWN otherwise (assume satisfiable for reachability)

Reachability algorithm:
- BFS/DFS from roots following ENABLED edges where condition is not provably UNSAT.
- Mark nodes reachable.
- Required nodes must be reachable.

8.2 Dependency graphs
- Edge graph cycle detection:
   - Kahn’s algorithm or DFS cycle detection on runtime nodes/edges.
- Compute dependency cycle detection:
   - Build graph of COMPUTE nodes based on nodeOutputRef references.
   - Detect cycles separately.

9) Required logging & audit (publish/restore)

9.1 Publish audit event
- actorUserId
- orgId, productId
- treeId/version
- validation summary (counts + top 3 warnings)
- change fingerprint (hash of normalized tree content)
- timestamp

9.2 Restore audit event
- actorUserId
- entity restored (nodeId/edgeId)
- result + warnings
- timestamp

10) “Grommets banner” validation expectations (specific to your example)

- N2 spacing min/max must validate (6..48).
- If grommetsEnabled default true, and spacing default 24, required inputs should be reachable when grommetsEnabled true.
- overageCount > 0 gate should be type-safe: overageCount NUMBER.
- pricebookRef finishing.grommets.overageUnitPrice must resolve at publish (preferred) OR publish warns and runtime blocks evaluation if missing.

11) Policy toggles (make these explicit in config, do not hardcode)

- strictPricebookRefsAtPublish: boolean
- divByZeroStrict: boolean
- negativeQuantityStrict: boolean
- ambiguousEdgesStrict: boolean
- outOfRangeSelectionsStrict: boolean

Recommendation defaults for production:
- strictPricebookRefsAtPublish = true
- divByZeroStrict = false (warning) initially
- negativeQuantityStrict = false (warning) initially
- ambiguousEdgesStrict = true (error) to prevent surprises
- outOfRangeSelectionsStrict = true (error)

12) Deliverables after this spec (next steps, not code)
- Convert this validation spec into:
   - a server-side validator module returning findings[]
   - a shared client schema for rendering findings in the editor
   - publish endpoint that blocks on ERROR
   - restore endpoint that blocks on ERROR
```

---

## Appendix 6 — Ref Contract + ExpressionSpec Hardening (FINAL)

```text
Product Builder v2 — Ref Contract + ExpressionSpec Hardening (FINAL)
Source baseline: PRODUCT_BUILDER_V2_OPTION_TREE_ARCHITECTURE.md

Purpose
- Define the final, authoritative Ref Contract and ExpressionSpec operator/type rules.
- Ensure evaluation is deterministic, type-safe, auditable, and free of cross-domain leakage.
- Ensure EFFECT nodes cannot influence pricing or computation.
- Preserve the explicit-vs-effective selection boundary so defaults remain audit-safe.

Non-negotiable outcomes
- All refs resolve deterministically or fail with stable, typed errors.
- No circular dependencies (edges graph, compute dependency graph, or ref graph).
- No cross-node-type contamination (EFFECT is output-only; PRICE is pricing-only).
- Evaluation uses immutable treeVersionId only (preview exceptions handled by runtime gate; see Appendix 5).
- Defaults never become “explicit selections”.

YOU MUST START WITH (IN THIS ORDER)

1) Enumerate all allowed Ref types

Allowed Ref kinds (ONLY these)
1) constant
2) selectionRef
3) effectiveRef
4) nodeOutputRef
5) envRef
6) pricebookRef

Ref kind definitions (shape + meaning)

A) constant
- Meaning: literal value embedded in ExpressionSpec.
- Types allowed: NUMBER | STRING | BOOLEAN | NULL.
- Notes: arrays/objects are NOT allowed as constants in ExpressionSpec (prevents accidental non-deterministic deep ops and keeps AST simple).

B) selectionRef
- Meaning: user-explicit value from selectionsV2 by INPUT.selectionKey.
- Addressing: selectionKey (string).
- Resolution: looks up in selectionsV2.explicitSelections[selectionKey].
- Type source of truth: INPUT.valueType for the INPUT node owning selectionKey.
- Failure:
   - If selectionKey unknown in tree => hard error (publish-time if referenced; eval-time if reached).
   - If not provided by user => resolves to NULL (not default), so expressions must use coalesce/exists.

C) effectiveRef
- Meaning: engine-effective value for an INPUT.selectionKey after applying defaults + sanitization policy.
- Addressing: selectionKey (string).
- Resolution: looks up in evaluationContext.effectiveInputs[selectionKey].
- Type source of truth: INPUT.valueType.
- Notes:
   - effectiveRef always has a value at runtime for ENABLED, reachable inputs that have defaults or are required (subject to validation + runtime gate).
   - effectiveRef must never mutate selectionsV2; it is derived.

D) nodeOutputRef
- Meaning: reference to a COMPUTE node output.
- Addressing:
   - nodeId (stable within a treeVersion)
   - outputKey (string)
- Resolution: looks up in evaluationContext.computedOutputsByNodeId[nodeId][outputKey].
- Type source of truth: COMPUTE.outputSchema[outputKey].type.
- Hard constraint: nodeOutputRef may ONLY target COMPUTE nodes (never PRICE, never EFFECT, never INPUT, never GROUP).

E) envRef
- Meaning: reference to deterministic runtime environment values supplied by the caller.
- Addressing: envKey (string) from the allowed env set.
- Allowed env keys (canonical set; extend only via versioned spec change):
   - widthIn, heightIn
   - quantity
   - sqft
   - perimeterIn
   - nowEpochMs (FORBIDDEN for persisted pricing; allowed only in preview mode)
- Resolution: looks up in evaluationContext.env[envKey].
- Type source of truth: envKey’s declared type (NUMBER unless explicitly declared otherwise).
- Hard constraint: persisted pricing evaluation must not allow time-varying env keys (e.g., nowEpochMs). Preview mode may allow them but must never persist snapshots.

F) pricebookRef
- Meaning: reference to a pricebook value by key.
- Addressing:
   - key (string)
   - scope (implicit; derived from evaluation context: organizationId + productId + variantId)
- Resolution behavior:
   - Publish-time: must be resolvable if strictPricebookRefsAtPublish=true.
   - Evaluation-time (persisted snapshot): must resolve OR evaluation fails.
- Type source of truth: pricebook value type must be NUMBER (cents) unless spec explicitly introduces other types.
- Hard constraint (domain isolation): pricebookRef is legal ONLY in PRICE node contexts (see section 2).

2) Define where each Ref type is legal (INPUT / COMPUTE / PRICE / CONDITION / EFFECT)

Ref legality by context (authoritative)

Context: INPUT
- Allowed: constant (ONLY inside valueDef defaults; no refs).
- Forbidden: selectionRef, effectiveRef, nodeOutputRef, envRef, pricebookRef.
Rationale: INPUT definitions must be static, portable, and independent of runtime/evaluation.

Context: COMPUTE.expression
- Allowed: constant, selectionRef, effectiveRef, nodeOutputRef (to COMPUTE only), envRef.
- Forbidden: pricebookRef.
Rationale: COMPUTE must be pure and pricing-domain-independent.

Context: CONDITION (edge condition)
- Allowed: constant, selectionRef, effectiveRef, nodeOutputRef (to COMPUTE only), envRef.
- Forbidden: pricebookRef.
Rationale: Graph visibility/routing must not depend on external pricebook state.

Context: PRICE components (quantityRef/unitPriceRef/overageBaseRef and any internal expressions)
- Allowed: constant, selectionRef, effectiveRef, nodeOutputRef (to COMPUTE only), envRef, pricebookRef.
- Forbidden: any ref targeting EFFECT outputs; any write/mutation primitive.
Rationale: PRICE may depend on compute + inputs + env + pricebook, but must remain read-only and deterministic.

Context: EFFECT outputs (valueRef)
- Allowed: constant, selectionRef, effectiveRef, nodeOutputRef (to COMPUTE only), envRef.
- Forbidden: pricebookRef.
Rationale: EFFECTs describe production/fulfillment artifacts and must not become pricing-coupled.

3) Explicitly list forbidden Ref usages and why

Forbidden usages (hard errors)

F1) Any ref to GROUP nodes
- Reason: GROUP nodes are editor-only and excluded from runtime evaluation.

F2) nodeOutputRef targeting anything other than COMPUTE
- Specifically forbidden targets: INPUT, PRICE, EFFECT, GROUP.
- Reason: prevents side-effect propagation, pricing leakage, and evaluation order ambiguity.

F3) Any attempt for EFFECT to influence pricing or computation
- Forbidden by construction:
   - PRICE/COMPUTE/CONDITION may not reference EFFECT outputs.
   - EFFECT outputs are not addressable by any Ref kind.
- Reason: ensures separation of concerns and removes circular/cross-domain dependencies.

F4) pricebookRef in COMPUTE/CONDITION/EFFECT
- Reason: pricebook state is external; using it outside PRICE creates hidden coupling and non-local behavior.

F5) Cross-tree references
- Any ref that would resolve outside the current treeVersion scope is invalid.
- Reason: prevents orphan references and ensures snapshots remain evaluable.

F6) Time-varying env refs in persisted evaluation
- nowEpochMs or any time/random source is forbidden when persisting PricingSnapshot.
- Reason: determinism and audit integrity.

F7) Any implicit type coercion
- Example: treating "24" as number 24.
- Reason: prevents drift between editor/runtime, and avoids silent data corruption.

4) Define naming guarantees (selectionKey vs node.key vs output keys)

Naming contracts (authoritative)

A) INPUT.selectionKey
- Purpose: persistence contract for selectionsV2 and snapshots.
- Uniqueness: must be globally unique among INPUT nodes within a treeVersion (ENABLED + DISABLED). (See Appendix 5 PBV2_E_SELECTION_KEY_COLLISION.)
- Stability: once a treeVersion is ACTIVE, selectionKey must never change in-place.
- User-facing guarantee: selectionKey is the canonical identifier shown in audit and stored in snapshots.

B) node.key
- Purpose: human-friendly stable label for referencing and debugging; NOT the persistence key.
- Uniqueness: must be unique among nodes within a treeVersion for ENABLED + DISABLED nodes. (See Appendix 5 PBV2_E_TREE_KEY_COLLISION.)
- Stability: may change only in DRAFT (because keys appear in UI and audit), but must remain unique.
- Note: expressions MUST NOT reference node.key directly; they reference nodeId/outputKey.

C) COMPUTE output keys
- outputKey is unique within a compute node.
- outputKey must be non-empty and stable once ACTIVE.

D) Ref addressing rules
- selectionRef/effectiveRef address by selectionKey.
- nodeOutputRef addresses by (nodeId, outputKey).
- pricebookRef addresses by pricebook key.
- envRef addresses by envKey.

5) Define evaluation visibility rules (what exists when)

Evaluation phases (visibility + lifecycle)

Phase 0: Inputs available (explicit selections)
- Available data: selectionsV2.explicitSelections.
- Not available: defaults are not yet applied here.

Phase 1: Effective inputs computed
- effectiveInputs derived from:
   - explicit selections (if present and type-valid)
   - otherwise defaults (if defined)
   - otherwise NULL (if optional)
   - required inputs missing at runtime => runtime gate error
- Sanitization policy:
   - Clamp/out-of-range behavior controlled by outOfRangeSelectionsStrict.
   - Sanitization MUST NOT mutate explicit selections.

Phase 2: Compute outputs computed
- Compute nodes evaluated in a deterministic topological order of the compute-dependency graph.
- nodeOutputRef visibility:
   - A compute output is visible only after its source compute node is evaluated.
   - Cycles are forbidden (Appendix 5 PBV2_E_EXPR_COMPUTE_DEP_CYCLE).

Phase 3: Edge conditions evaluated
- Conditions may use effectiveInputs + compute outputs + env.
- Conditions must not consult pricebook.
- Outgoing edge evaluation ordering:
   - Deterministic: sort by (priority asc, edgeId asc).
   - Ambiguity handling:
      - If multiple edges match with same priority => warning/error per policy (Appendix 5 PBV2_W_EDGE_AMBIGUOUS_MATCH).

Phase 4: Pricing evaluated
- Pricing may use effectiveInputs + compute outputs + env + pricebook.
- PRICE nodes emit price components only; they do not alter selections/effectiveInputs/compute outputs.

Phase 5: Effects evaluated
- Effects may use effectiveInputs + compute outputs + env.
- Effects are output-only artifacts for production/ops.

A) Ref Contract Specification

Ref kinds
- constant, selectionRef, effectiveRef, nodeOutputRef, envRef, pricebookRef (ONLY).

Scope and lifetime

constant
- Scope: local to the expression AST.
- Lifetime: permanent (serialized with tree version).

selectionRef
- Scope: evaluation call only (depends on selectionsV2).
- Lifetime: derived from persisted selectionsV2; stable for a given snapshot.

effectiveRef
- Scope: evaluation call only (derived from explicit selections + defaults + sanitization).
- Lifetime: ephemeral but may be recorded into PricingSnapshot.effectiveInputs for audit/debug.

nodeOutputRef
- Scope: evaluation call only.
- Lifetime: ephemeral; may be recorded into PricingSnapshot.computedOutputs for audit/debug.

envRef
- Scope: evaluation call only.
- Lifetime: ephemeral; may be recorded (selectively) in snapshot if needed for audit.

pricebookRef
- Scope: evaluation call only.
- Lifetime: ephemeral at evaluation; the resolved numeric value(s) used MUST be frozen into PricingSnapshot.breakdown (and/or a “resolvedPricebookValues” map) so historical totals remain reproducible even if pricebook changes later.

Resolution order (deterministic)
1) Validate AST (parse + operator whitelist)
2) Resolve Ref addresses to typed symbols using the treeVersion’s symbol tables:
    - selectionKey table (INPUT)
    - compute output table (COMPUTE)
    - envKey table (ENV)
    - pricebook key table (PRICEBOOK)
3) Type-check the entire AST bottom-up
4) Evaluate with stable ordering (no iteration over unordered maps without sorting)

Failure behavior (authoritative)
- Unresolved ref: fail with a stable error code and path.
- Type mismatch: fail with stable error code and path.
- Missing selection value:
   - selectionRef => NULL (use coalesce/exists)
   - effectiveRef => must be available for required inputs (else error)
- Missing pricebook value:
   - If strictPricebookRefsAtPublish=true => publish blocks.
   - If evaluating persisted snapshot => evaluation fails (no silent fallbacks).

B) ExpressionSpec Hardening

ExpressionSpec operator whitelist (complete)

Literals and refs
- literal(value)
- ref(Ref)

Core boolean operators
- and(a: BOOLEAN, b: BOOLEAN) -> BOOLEAN
- or(a: BOOLEAN, b: BOOLEAN) -> BOOLEAN
- not(a: BOOLEAN) -> BOOLEAN

Comparisons (no coercion; operands must be same type)
- eq(a: T, b: T) -> BOOLEAN
- ne(a: T, b: T) -> BOOLEAN
- lt(a: NUMBER, b: NUMBER) -> BOOLEAN
- lte(a: NUMBER, b: NUMBER) -> BOOLEAN
- gt(a: NUMBER, b: NUMBER) -> BOOLEAN
- gte(a: NUMBER, b: NUMBER) -> BOOLEAN

Numeric arithmetic (NUMBER only)
- add(a: NUMBER, b: NUMBER) -> NUMBER
- sub(a: NUMBER, b: NUMBER) -> NUMBER
- mul(a: NUMBER, b: NUMBER) -> NUMBER
- div(a: NUMBER, b: NUMBER) -> NUMBER
- mod(a: NUMBER, b: NUMBER) -> NUMBER
- abs(a: NUMBER) -> NUMBER
- min(a: NUMBER, b: NUMBER) -> NUMBER
- max(a: NUMBER, b: NUMBER) -> NUMBER
- clamp(x: NUMBER, lo: NUMBER, hi: NUMBER) -> NUMBER
- round(x: NUMBER, digits?: NUMBER) -> NUMBER
- floor(x: NUMBER) -> NUMBER
- ceil(x: NUMBER) -> NUMBER

Conditional
- if(cond: BOOLEAN, then: T, else: T) -> T

Nullability helpers
- exists(x: T|NULL) -> BOOLEAN
- coalesce(a: T|NULL, b: T|NULL, ...rest: (T|NULL)[]) -> T|NULL
   - Note: coalesce returns first non-NULL in order; if all NULL => NULL.

String (optional; only if needed; otherwise forbid entirely)
- concat(a: STRING, b: STRING, ...rest: STRING[]) -> STRING
- strlen(a: STRING) -> NUMBER

Type rules (no implicit coercion)
- Operators accept only the types declared above.
- NULL is only legal where explicitly allowed (exists/coalesce and as selectionRef output).
- Comparisons eq/ne require identical types, including nullability.

Guard patterns (recognized and required by policy)

Division
- Required guard patterns (recognized as “safe”):
   - if(eq(den, 0), 0, div(num, den))
   - div(num, clamp(den, eps, hi))  (eps is a constant > 0)
- Policy toggle: divByZeroStrict
   - true => any div without recognized guard is ERROR
   - false => WARNING (unless denominator is literal 0 => ERROR)

Existence / requiredness
- selectionRef may be NULL; expressions should use coalesce/exists.
- effectiveRef should not be NULL for required inputs when reachable; runtime gate enforces.

Clamping
- For numeric inputs with constraints, clamping is an explicit operation.
- Policy toggle: outOfRangeSelectionsStrict
   - true => out-of-range is ERROR
   - false => may clamp in “effective inputs” phase but must still log WARNING and record original.

Determinism guarantees
- Evaluation order is deterministic:
   - compute dependency graph topologically sorted by (dependency order, then nodeId asc)
   - edges evaluated by (priority asc, edgeId asc)
- No access to nondeterministic sources (time/random) in persisted evaluation.
- No dependence on unordered iteration.
- Pricebook values used are frozen into PricingSnapshot so totals remain reproducible.

C) Forbidden Dependency Matrix (authoritative)

Legend
- Allowed: the left context may reference the right domain.
- Forbidden: hard error.

Domains
- INPUT selections (selectionKey)
- Effective inputs (effectiveRef)
- COMPUTE outputs (nodeOutputRef to COMPUTE)
- ENV (envRef)
- PRICEBOOK (pricebookRef)
- EFFECT outputs
- GROUP nodes

Matrix (Context -> Target)

COMPUTE
- Allowed: INPUT selections, Effective inputs, COMPUTE outputs, ENV
- Forbidden: PRICEBOOK, EFFECT outputs, GROUP

CONDITION
- Allowed: INPUT selections, Effective inputs, COMPUTE outputs, ENV
- Forbidden: PRICEBOOK, EFFECT outputs, GROUP

PRICE
- Allowed: INPUT selections, Effective inputs, COMPUTE outputs, ENV, PRICEBOOK
- Forbidden: EFFECT outputs, GROUP

EFFECT
- Allowed: INPUT selections, Effective inputs, COMPUTE outputs, ENV
- Forbidden: PRICEBOOK, EFFECT outputs (no self-referencing chain), GROUP

INPUT
- Allowed: constants only
- Forbidden: everything else

D) Default & Audit Rules (authoritative)

Explicit vs effective values
- Explicit selection:
   - Only what the user actually entered/selected.
   - Persisted in selectionsV2.explicitSelections by selectionKey.
- Default application:
   - Defaults are applied at evaluation time to produce effectiveInputs.
   - Defaults MUST NOT be written into explicitSelections.

Effective values
- effectiveInputs is the engine-resolved value after defaults + policy sanitization.
- effectiveInputs may be stored in PricingSnapshot.effectiveInputs for audit/debug.

PricingSnapshot freezing rules (what is immutable once priced)
- PricingSnapshot MUST record:
   - treeVersionId
   - selectionsV2.explicitSelections (as provided)
   - effectiveInputs (recommended)
   - computedOutputs (recommended)
   - pricing breakdown components (authoritative), including resolved unit prices
   - totals in cents (authoritative)
- PricingSnapshot MUST NOT require reevaluating against current pricebook to reproduce totals.

Selection defaults remain audit-safe
- Audit views must distinguish:
   - Explicit: what the user chose
   - Effective: what the engine used (including defaults)
- Any UI that displays “selected” values must label default-applied values as derived, not explicit.

E) Concrete Mini-Examples

E1) Valid compute expression
- Goal: compute grommetOverageCount as a number

Expression
   if(
      effectiveRef(grommetsEnabled),
      max(0, sub(nodeOutputRef(perimeterComputeId, perimeterIn), effectiveRef(includedPerimeterIn))),
      0
   )

Why valid
- Uses effectiveRef + nodeOutputRef to COMPUTE.
- No pricebook.
- Types: BOOLEAN in if condition; NUMBER branches.

E2) Invalid expression (and why)

Expression
   add(effectiveRef(grommetsEnabled), 1)

Why invalid
- effectiveRef(grommetsEnabled) is BOOLEAN.
- add requires NUMBER + NUMBER.
- No implicit coercion allowed.

E3) Valid pricing ref chain

PRICE component
- kind: PER_OVERAGE
- quantityRef: nodeOutputRef(overageCountComputeId, overageCount)   (NUMBER)
- overageBaseRef: constant(0)                                      (NUMBER)
- unitPriceRef: pricebookRef(finishing.grommets.overageUnitPrice)  (NUMBER cents)

Why valid
- PRICE may reference COMPUTE outputs + pricebook.
- Deterministic if pricebook resolve is stable at publish/eval and value is frozen into snapshot breakdown.

E4) Forbidden ref chain

Forbidden chain
- COMPUTE expression tries to use pricebookRef(finishing.grommets.overageUnitPrice)

Why forbidden
- pricebookRef is illegal in COMPUTE context.
- Prevents pricing-domain leakage into computation/visibility.

Also forbidden
- PRICE tries to reference an EFFECT output via nodeOutputRef(effectNodeId, someKey)

Why forbidden
- nodeOutputRef may only target COMPUTE nodes.
- Ensures EFFECT cannot influence pricing.
```
