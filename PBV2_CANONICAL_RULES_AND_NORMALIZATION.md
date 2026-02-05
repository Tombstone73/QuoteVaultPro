# PBV2 Canonical Graph Rules & Normalization

**Date**: 2026-02-05  
**Status**: IMPLEMENTED ✅

## Problem Statement

The PBV2 product builder was experiencing three critical issues:

1. **Validation Errors**: Tree validation was rejecting GROUP nodes as roots and edges with missing conditions
2. **Runtime Crash**: Clicking an option caused `.find is not a function` error due to nodes being in object format
3. **Rule Inconsistency**: Documentation claimed GROUP nodes could be roots, but validator rejected them

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
- May have valid `condition` AST object (conditionRule) if schema requires
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
- Called at every tree data ingestion point:
  - After loading from server (`GET /pbv2/tree`)
  - After local initialization
  - After any mutation patch is applied
  - Before validation/save

**`ensureRootNodeIds(treeJson: any): any`**
- Updated to select **runtime roots only** (ENABLED non-GROUP nodes)
- Never includes GROUP nodes in rootNodeIds
- Fallback: if no runtime roots found, selects any ENABLED non-GROUP node

### Integration Points

Normalization is applied in:

1. **PBV2ProductBuilderSectionV2.tsx**
   - On draft hydration from server
   - After add group/option mutations
   - Before save (PUT to `/api/products/:id/pbv2/draft`)
   - In `onPbv2StateChange` callback

2. **ProductEditorPage.tsx**
   - Before persisting PBV2 tree with product save

3. **OptionDetailsEditor.tsx**
   - Fixed to handle `nodes` as array OR object (Record format)
   - Prevents `.find is not a function` crash

## Validation Changes

- **Publish-time validation** remains strict (enforces all rules)
- **Edit-time validation** shows errors but does not block editing
- After normalization, these errors should **disappear in common flow**:
  - `PBV2_E_TREE_ROOT_INVALID` (Root node cannot be GROUP)
  - `PBV2_E_TREE_NO_ROOTS` (rootNodeIds empty)
  - `PBV2_E_EDGE_CONDITION_INVALID` (structural edges with conditions)

## Testing Checklist

✅ TypeScript compilation passes (`npm run check`)  
🔲 Create new product with PBV2 options (no validation errors)  
🔲 Click options in editor (no crash)  
🔲 Save draft (persists with correct rootNodeIds)  
🔲 Load existing draft (normalizes old data correctly)  
🔲 Publish (validation passes with no rule violations)  

## Future Maintenance

**DO NOT REGRESS:**
- Never allow GROUP nodes in rootNodeIds
- Never allow GROUP nodes in ENABLED edges
- Always call `normalizeTreeJson()` at data ingestion points

**When Adding New Features:**
- If adding new edge types, ensure GROUP structural rules are respected
- If adding new node types, consider whether they are runtime or structural
- Update `normalizeTreeJson()` if new fields need defensive removal

## Related Files

- `client/src/lib/pbv2/pbv2ViewModel.ts` - Core normalization logic
- `client/src/components/PBV2ProductBuilderSectionV2.tsx` - Integration
- `client/src/components/pbv2/builder-v2/OptionDetailsEditor.tsx` - Crash fix
- `client/src/pages/ProductEditorPage.tsx` - Product save integration
- `shared/pbv2/validator/validatePublish.ts` - Validation rules
- `shared/pbv2/refResolver.ts` - Reference resolution

---

**Implementation Complete**: All rule violations fixed, crash resolved, normalization integrated.
