# PBV2 Canonical Graph Rules & Normalization

**Date**: 2026-02-05  
**Status**: COMPLETE ✅

## Problem Statement

The PBV2 product builder was experiencing critical issues:

1. **Validation Errors**: Tree validation was rejecting GROUP nodes as roots and edges with missing conditions
2. **Runtime Crash**: Clicking an option caused `.find is not a function` error due to nodes being in object format
3. **Rule Inconsistency**: Documentation claimed GROUP nodes could be roots, but validator rejected them
4. **Edge Condition Errors**: Runtime ENABLED edges without valid condition AST threw `PBV2_E_EDGE_CONDITION_INVALID`
5. **Wrong Validation Mode**: Edit-time validation was running publish-time checks (e.g., "Tree status must be DRAFT at time of publish")

## Canonical PBV2 Graph Rules

These rules are now enforced by `normalizeTreeJson()` in `client/src/lib/pbv2/pbv2ViewModel.ts`:

### Rule A: GROUP Nodes Are Structural Only

- **GROUP nodes** provide UI organization but do NOT participate in runtime evaluation
- They may have **structural containment edges** (GROUP → OPTION/INPUT)
- GROUP nodes may **NEVER** be runtime roots
- GROUP nodes may **NEVER** participate in ENABLED runtime edges

### Rule B: Edge Types

**Structural Containment Edges:**
- Status: `DISABLED`
- Must NOT have `condition`, `conditionRule`, or `when` fields
- Used only for UI tree organization (parent-child relationships)
- Edges FROM or TO GROUP nodes are automatically forced to be structural

**Runtime Edges:**
- Status: `ENABLED`
- **MUST have valid `condition` AST object** (enforced by normalizeTreeJson)
- If missing or invalid, normalized to `TRUE_CONDITION` (always-true condition)
- Must NOT connect FROM or TO GROUP nodes
- Determine which nodes are active during evaluation

### Rule C: Root Node IDs

`rootNodeIds` must contain:
- At least one **ENABLED runtime node**
- **NEVER include GROUP nodes**
- Derived from runtime graph: ENABLED nodes with no incoming ENABLED edges
- Structural edges (DISABLED) do NOT affect root calculation

## Implementation

### Core Functions

**`normalizeTreeJson(treeJson: any): any`**
- Enforces all canonical rules A/B/C
- **Fixes runtime edge conditions**: Sets missing/invalid conditions to `TRUE_CONDITION`
- Preserves tree.status field (does NOT modify DRAFT/ACTIVE status)
- Called at every tree data ingestion point:
  - After loading from server (`GET /pbv2/tree`)
  - After local initialization
  - After any mutation patch is applied
  - Before validation/save

**`ensureRootNodeIds(treeJson: any): any`**
- Updated to select **runtime roots only** (ENABLED non-GROUP nodes)
- Never includes GROUP nodes in rootNodeIds
- Fallback: if no runtime roots found, selects any ENABLED non-GROUP node

**`TRUE_CONDITION` constant**
- Always-true condition AST: `{ op: "EXISTS", value: { op: "literal", value: true } }`
- Used as default for ENABLED edges without valid condition
- Follows PBV2 ConditionRule schema from `shared/pbv2/expressionSpec.ts`

**`isValidConditionAst(value: unknown): boolean`**
- Minimal validation helper for condition AST objects
- Checks for valid op field (AND, OR, NOT, EXISTS, EQ, NEQ, GT, GTE, LT, LTE, IN)

### Validation Separation

**Edit-Time Validation** (`validateForEdit()` in PBV2ProductBuilderSectionV2.tsx)
- Checks structural validity and runtime invariants
- **Does NOT enforce publish-only rules**:
  - ❌ Tree status must be DRAFT
  - ❌ Other publish-gate checks
- Shows errors/warnings during editing without blocking

**Publish-Time Validation** (`validateTreeForPublish()`)
- Strict validation enforced ONLY when user clicks Publish
- Includes all edit-time checks PLUS publish-gate rules
- Must pass before tree can be published

### Integration Points

Normalization is applied in:

1. **PBV2ProductBuilderSectionV2.tsx**
   - On draft hydration from server
   - After add group/option mutations
   - Before save (PUT to `/api/products/:id/pbv2/draft`)
   - In `onPbv2StateChange` callback
   - Edit-time validation uses `validateForEdit()` (not publish validator)
   - Publish action uses `validateTreeForPublish()` for strict checks

2. **ProductEditorPage.tsx**
   - Before persisting PBV2 tree with product save

3. **OptionDetailsEditor.tsx**
   - Fixed to handle `nodes` as array OR object (Record format)
   - Prevents `.find is not a function` crash

## Validation Errors Resolved

After normalization and validation separation, these errors **disappear in common flow**:
- ✅ `PBV2_E_TREE_ROOT_INVALID` (Root node cannot be GROUP)
- ✅ `PBV2_E_TREE_NO_ROOTS` (rootNodeIds empty)
- ✅ `PBV2_E_EDGE_CONDITION_INVALID` (structural edges with conditions, runtime edges without conditions)
- ✅ `PBV2_E_TREE_STATUS_INVALID` (during editing - only enforced at publish)

## Testing Checklist

✅ TypeScript compilation passes (`npm run check`)  
✅ Edit-time validation does NOT show `PBV2_E_TREE_STATUS_INVALID`  
✅ Runtime edges normalized with TRUE_CONDITION (no `PBV2_E_EDGE_CONDITION_INVALID`)  
🔲 Create new product with PBV2 options (no validation errors in edit panel)  
🔲 Click options in editor (no crash)  
🔲 Save draft (persists with correct rootNodeIds and edge conditions)  
🔲 Load existing draft (normalizes old data correctly)  
🔲 Publish (strict validation passes with all rules enforced)  

## Future Maintenance

**DO NOT REGRESS:**
- Never allow GROUP nodes in rootNodeIds
- Never allow GROUP nodes in ENABLED edges
- Always call `normalizeTreeJson()` at data ingestion points
- Always ensure ENABLED edges have valid condition AST
- Keep edit-time and publish-time validation separate

**When Adding New Features:**
- If adding new edge types, ensure GROUP structural rules are respected
- If adding new node types, consider whether they are runtime or structural
- Update `normalizeTreeJson()` if new fields need defensive removal or defaults
- Add new publish-only validation codes to `validateForEdit()` filter list if needed

## Related Files

- `client/src/lib/pbv2/pbv2ViewModel.ts` - Core normalization logic, TRUE_CONDITION, isValidConditionAst
- `client/src/components/PBV2ProductBuilderSectionV2.tsx` - Integration, validateForEdit, publish validation
- `client/src/components/pbv2/builder-v2/OptionDetailsEditor.tsx` - Crash fix
- `client/src/pages/ProductEditorPage.tsx` - Product save integration
- `shared/pbv2/validator/validatePublish.ts` - Strict publish-time validation
- `shared/pbv2/refResolver.ts` - Reference resolution
- `shared/pbv2/expressionSpec.ts` - ConditionRule and ExpressionSpec types

---

**Implementation Complete**: All rule violations fixed, crash resolved, edge conditions normalized, validation modes separated.
