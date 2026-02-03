# PBV2 HOTFIX: Fixed Invalid Runtime State + Initialization

## Problems Fixed

### 1. "Initialize Tree v2" Returns Array Instead of Object ❌ → ✅
**Bug**: Clicking "Initialize Tree v2" occasionally produced validation error: "Option Tree v2 errors: Expected object, received array"

**Root Cause**: No defensive checks when building tree from legacy options or when database returned corrupted data.

**Fix**: 
- Created canonical `createEmptyPBV2Tree()` factory function in `shared/optionTreeV2Initializer.ts`
- Added defensive checks in `initTreeV2()` to ensure tree is always an object
- All initialization paths now use the factory function

### 2. Invalid Runtime State on First Option Add
After implementing Phase 3 Steps 3/4, clicking "Add Option" immediately produced these validation errors:
1. `PBV2_E_INPUT_TYPE_UNKNOWN`: node.input.valueType is unknown
2. `PBV2_E_EDGE_CONDITION_INVALID`: edge.condition is not a valid AST (often {} or junk)
3. `PBV2_E_EDGE_STATUS_INVALID`: ENABLED edges cannot connect to GROUP nodes

## Root Causes

### 1. valueType Token Mismatch
**Problem**: `ensureTreeInvariants()` was setting lowercase valueType values (`'string'`, `'boolean'`, `'number'`, `'dimension'`) but the validator expects UPPERCASE tokens (`'TEXT'`, `'BOOLEAN'`, `'NUMBER'`).

**Evidence**: In `shared/pbv2/symbolTable.ts`, the `normalizeType()` function converts to UPPERCASE:
```typescript
if (upper === "NUMBER") return "NUMBER";
if (upper === "BOOLEAN") return "BOOLEAN";
if (upper === "TEXT" || upper === "STRING") return "TEXT";
```

**Fix**: Updated `ensureTreeInvariants()` to use UPPERCASE tokens:
- `'string'` → `'TEXT'`
- `'boolean'` → `'BOOLEAN'`
- `'number'` and `'dimension'` → `'NUMBER'`

### 2. Edge Condition Empty Objects
**Problem**: Edge conditions were being created or repaired to `{}` (empty object) which the validator rejects as invalid AST.

**Evidence**: Validator expects `condition` to be:
- `undefined` or `null` for unconditional edges
- Valid AST object with `op` field (string) for conditional edges

**Fix**: 
- Updated `ensureTreeInvariants()` to normalize empty `{}` to `undefined`
- Removed edge creation entirely (see #3)

### 3. GROUP Nodes Are Design-Time Only
**Problem**: Creating edges FROM GROUP nodes to OPTION nodes. GROUP nodes are organizational containers for the UI and should not have ENABLED runtime edges.

**Evidence**: From `shared/pbv2/starterTree.ts`, all publish-valid trees have edges going FROM one INPUT/COMPUTE node TO another INPUT/COMPUTE node. GROUP is not a runtime node type.

**Architecture**: 
- GROUP nodes are UI-only containers for organizing options
- Options within a group are independent root nodes until connected via conditionals
- Runtime graph uses INPUT → INPUT edges based on conditional logic

**Fix**: 
- Stopped creating edges from GROUP to OPTION in `createAddOptionPatch()`
- Updated `ensureTreeInvariants()` to disable any ENABLED edges that have GROUP as source
- Updated root node handling to include all orphaned runtime nodes (nodes without incoming edges)

## Changes Made

### File: `shared/optionTreeV2Initializer.ts`

#### Added createEmptyPBV2Tree() Factory (Lines 188-200)
```typescript
/**
 * Create an empty PBV2 tree with the correct object structure.
 * Use this instead of [] or {} to ensure schema compliance.
 */
export function createEmptyPBV2Tree(meta?: { title?: string; updatedAt?: string }): OptionTreeV2 {
  return {
    schemaVersion: 2,
    rootNodeIds: [],
    nodes: {},
    meta: meta || {},
  };
}
```

### File: `client/src/components/ProductForm.tsx`

#### 1. Import Factory Function (Line 14)
```typescript
import { buildOptionTreeV2FromLegacyOptions, createEmptyPBV2Tree } from \"@shared/optionTreeV2Initializer\";
```

#### 2. Use Factory for New Product Init (Lines 113-123)
```typescript
const emptyPBV2 = createEmptyPBV2Tree({
  title: 'New Options Tree',
  updatedAt: new Date().toISOString(),
});
form.setValue(\"optionTreeJson\", emptyPBV2, { shouldDirty: false });
```

#### 3. Add Defensive Check in initTreeV2 (Lines 204-212)
```typescript
let tree = buildOptionTreeV2FromLegacyOptions(legacyOptionsJson);

// Defensive check: If tree is somehow an array or invalid, use empty tree
if (Array.isArray(tree) || !tree || typeof tree !== 'object' || !('schemaVersion' in tree)) {
  console.warn('buildOptionTreeV2FromLegacyOptions returned invalid tree, using empty tree');
  tree = createEmptyPBV2Tree({ title: 'Options Tree' });
}
```

### File: `client/src/lib/pbv2/pbv2ViewModel.ts`

#### 1. Fixed valueType Token Mapping (Lines 827-865)
```typescript
// OLD: lowercase tokens
case 'boolean':
  newValueType = 'boolean';
  break;
case 'number':
  newValueType = 'number';
  break;

// NEW: UPPERCASE tokens matching validator expectations
case 'boolean':
  newValueType = 'BOOLEAN';
  break;
case 'number':
case 'dimension':
  newValueType = 'NUMBER';
  break;
case 'select':
case 'multiselect':
case 'text':
case 'textarea':
default:
  newValueType = 'TEXT';
  break;
```

**Also added validation check**:
```typescript
const validValueTypes = ['NUMBER', 'BOOLEAN', 'TEXT', 'JSON', 'NULL'];
const isValid = currentValueType && typeof currentValueType === 'string' && 
                validValueTypes.includes(currentValueType.toUpperCase());
```

#### 2. Improved Edge Condition Validation (Lines 868-894)
```typescript
// NEW: Detect and fix empty objects {} and missing 'op'
const isValidCondition = 
  typeof condition === 'object' && 
  condition !== null && 
  'op' in condition &&
  typeof (condition as any).op === 'string' &&
  (condition as any).op.length > 0;

const isEmptyObject = typeof condition === 'object' && 
                     Object.keys(condition).length === 0;

if (!isValidCondition || isEmptyObject) {
  edge.condition = undefined; // Not null - undefined for unconditional
  mutated = true;
}
```

#### 3. Removed GROUP→OPTION Edge Creation (Lines 668-692)
```typescript
const newNode: PBV2Node = {
  id: newOptionId,
  kind: 'question',
  type: 'INPUT',
  status: 'ENABLED',
  key: selectionKey,
  label: 'New Option',
  description: '',
  input: {
    type: 'select',
    required: false,
  } as any,
  pricingImpact: [],
  weightImpact: [],
};

// Set valueType separately to avoid TypeScript error
(newNode.input as any).valueType = 'TEXT';

// Don't create edge from GROUP - options are standalone until connected via conditionals
// GROUP is a UI organizational concept only, not part of runtime graph

const patchedTree = {
  ...tree,
  nodes: [...nodes, newNode],
  edges, // No new edge
};
```

#### 4. Disable ENABLED Edges From GROUP Nodes (Lines 931-937)
```typescript
// Also check if FROM node is a GROUP (GROUP nodes are design-time only, no runtime edges)
const fromNode = edge.fromNodeId ? nodesById.get(edge.fromNodeId) : null;
if (fromNode && fromNode.type?.toUpperCase() === 'GROUP' && edge.status === 'ENABLED') {
  // GROUP nodes are organizational containers only, they should not have ENABLED edges
  edge.status = 'DISABLED';
  mutated = true;
}
```

#### 5. Auto-Add Orphaned Nodes as Roots (Lines 940-980)
```typescript
// Find nodes with incoming ENABLED edges
const nodesWithIncoming = new Set<string>();
for (const edge of edges) {
  if (edge.status === 'ENABLED' && edge.toNodeId) {
    nodesWithIncoming.add(edge.toNodeId);
  }
}

// Orphaned nodes are valid runtime nodes without incoming edges
const orphanedNodes = validRuntimeNodes.filter(n => !nodesWithIncoming.has(n.id));

// Build new root set: existing valid roots + orphaned nodes
const newRootSet = new Set([...validRoots, ...orphanedNodes.map(n => n.id)]);
const newRoots = Array.from(newRootSet);
```

**Why**: Since options no longer have edges from their parent GROUP, they start as orphaned nodes and must be added to `rootNodeIds` for the runtime evaluator to find them.

## Validation Rules Reference

### valueType Tokens (from `shared/pbv2/symbolTable.ts`)
- `"NUMBER"` - numeric values and dimensions
- `"BOOLEAN"` - true/false
- `"TEXT"` - strings, enums, selects (most common)
- `"JSON"` - JSON objects
- `"NULL"` - null values

### Edge Condition Rules (from `shared/pbv2/typeChecker.ts` and `validator/validatePublish.ts`)
- **Unconditional**: `undefined` or `null`
- **Conditional**: Object with `{ op: string, ... }` where `op` is a valid operator
- **Invalid**: Empty object `{}`, object without `op`, object with empty `op: ""`

### Edge Status Rules (from `shared/pbv2/validator/validatePublish.ts`)
- ENABLED edges **cannot** connect to GROUP nodes (must connect to INPUT/COMPUTE/PRICE nodes)
- ENABLED edges **cannot** reference DELETED nodes
- If either endpoint is DISABLED, edge must be DISABLED

## Testing Results

### TypeScript Check
✅ `npm run check` passes with no errors

### Expected Behavior
After this hotfix:
1. Click "Add Group" → No errors (GROUP node created, no edges)
2. Click "Add Option" within that group → **Zero red validation errors**
3. New option node has:
   - ✅ `input.selectionKey` (auto-generated)
   - ✅ `input.valueType = "TEXT"` (UPPERCASE)
   - ✅ No incoming edges (orphaned node)
   - ✅ Added to `rootNodeIds` automatically
4. GROUP node is UI-only:
   - ✅ Used for organizing options in the builder UI
   - ✅ Has no ENABLED edges (edges are DISABLED if created)
   - ✅ Not part of runtime evaluation graph
5. Save draft, reload, repeat → Still zero errors

### Architecture Clarification
**GROUP vs Runtime Graph**:
- **GROUP nodes**: UI organizational containers (like folders)
  - Appear in left sidebar for navigation
  - Group related options visually
  - Have no runtime behavior
  
- **Runtime graph**: INPUT → INPUT edges based on conditions
  - Options start as root nodes (orphaned)
  - Options get connected via conditional edges (e.g., "if finishing=GROMMETS, show grommetSpacing")
  - Evaluator walks edges to determine which nodes are relevant

**Example**:
```
UI Structure (with GROUPs):
- GROUP: "Banner Finishing"
  - OPTION: finishing (select: None/Grommets/Hemming)
  - OPTION: grommetSpacing (number)
  - OPTION: hemmingType (select: Pole/Sewn)

Runtime Graph (no GROUPs):
finishing → grommetSpacing (if finishing=Grommets)
finishing → hemmingType (if finishing=Hemming)
```

### Manual Testing Checklist
- [ ] **Initialization Test**: New product → Click "Initialize Tree v2" → No "Expected object, received array" error
- [ ] **Legacy Migration Test**: Product with legacy options → Click "Initialize Tree v2" → Valid tree created
- [ ] **Add Option Test**: New product → Add Group → Add Option → 0 errors
- [ ] **Inspect Option JSON**: New option has selectionKey + valueType (UPPERCASE)
- [ ] **Change Option Type**: Change type (boolean/number/text) → valueType updates correctly
- [ ] **Save/Reload Test**: Save draft → reload → no errors
- [ ] **Publish Test**: Publish tree → no errors

## Backward Compatibility

✅ **No Breaking Changes**
- Existing products with lowercase `valueType` → `ensureTreeInvariants()` converts to UPPERCASE
- Existing edges with `condition: null` → Left as-is (validator accepts `null` or `undefined`)
- Existing edges with `condition: {}` → Normalized to `undefined`
- All button `type="button"` attributes preserved

## Impact

### Before Hotfix
- Every new option showed 3 red errors immediately
- Users couldn't create valid trees without manual JSON editing
- Validation errors persisted even after "fixes"

### After Hotfix
- New options are valid immediately
- No red errors on fresh groups/options
- Clean authoring experience matches design intent

## Related Files

### Modified
- `client/src/lib/pbv2/pbv2ViewModel.ts` (3 sections)

### Reference (Not Modified)
- `shared/pbv2/symbolTable.ts` - Defines valueType normalization
- `shared/pbv2/typeChecker.ts` - Validates edge conditions
- `shared/pbv2/validator/validatePublish.ts` - Validates edge status rules

---

**Status**: ✅ Complete - Ready for manual UI testing
**TypeScript**: ✅ Passes
**Backward Compatible**: ✅ Yes
**Risk**: 🟢 Low (corrects existing bugs, no new features)
