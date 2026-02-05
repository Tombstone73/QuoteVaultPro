# ProductEditorPage Save Pipeline State Machine

## Overview
This documents the complete save flow for ProductEditorPage, including single-flight guards, idempotency, and error handling.

## State Variables

### Single-Flight Guard
```typescript
saveInFlightRef: useRef<boolean>(false)
```
- **Purpose**: Prevent duplicate saves from rapid clicks
- **Set to true**: At start of `mutationFn`
- **Set to false**: In `mutationFn` catch block, `onSuccess` finally block, `onError` handler

### Idempotency Guard
```typescript
createdProductIdRef: useRef<string | null>(null)
```
- **Purpose**: Once product is created, convert subsequent saves to UPDATE (not CREATE)
- **Set**: In `onSuccess` after product creation returns ID
- **Used**: In `mutationFn` to determine if this is CREATE or UPDATE

### Mutation State
```typescript
saveMutation.isPending: boolean (from TanStack Query)
```
- **Purpose**: UI state indicator
- **Managed by**: TanStack Query automatically

## Save Flow State Machine

### State 1: IDLE
- **Conditions**: `saveInFlightRef.current === false`, `saveMutation.isPending === false`
- **UI**: Save button enabled, shows "Save Changes"
- **Allowed transitions**: User clicks Save → GUARD_CHECK

### State 2: GUARD_CHECK
- **Entry**: User clicks Save
- **Actions**: 
  1. `handleSave` checks `saveInFlightRef.current`
  2. If true → Stay in IDLE (blocked)
  3. If false → Call `saveMutation.mutate()` → MUTATION_START

### State 3: MUTATION_START
- **Entry**: `mutationFn` called
- **Actions**:
  1. Check `saveInFlightRef.current` (double guard)
  2. Set `saveInFlightRef.current = true`
  3. Determine if CREATE or UPDATE based on `createdProductIdRef.current`
  4. Log: `[SAVE_PIPELINE] phase=start`
- **Transitions**:
  - Success → PRODUCT_SAVED
  - Error → MUTATION_ERROR

### State 4: PRODUCT_SAVED
- **Entry**: API request succeeded
- **Actions**:
  1. Extract product data from response
  2. Log: `[SAVE_PIPELINE] phase=create-ok` or `phase=update-ok`
  3. Return product data
- **Transitions**: → ON_SUCCESS

### State 5: ON_SUCCESS
- **Entry**: Mutation succeeded, `onSuccess` called
- **Actions**:
  1. Store `createdProductIdRef.current` if new product
  2. Get fresh tree via `pbv2TreeProviderRef.current.getCurrentTree()`
- **Transitions**:
  - No tree → SUCCESS_NO_PBV2 (navigate)
  - Tree invalid → PBV2_INVALID (stay, error)
  - Tree valid → PBV2_FLUSH_START

### State 6: PBV2_FLUSH_START
- **Entry**: Valid tree exists
- **Actions**:
  1. Log: `[SAVE_PIPELINE] phase=pbv2-flush-start` with counts
  2. PUT `/api/products/${productId}/pbv2/draft`
- **Transitions**:
  - Success → PBV2_FLUSH_OK
  - Failure → PBV2_FLUSH_FAILED

### State 7: PBV2_FLUSH_OK
- **Entry**: Draft PUT succeeded
- **Actions**:
  1. Log: `[SAVE_PIPELINE] phase=pbv2-flush-ok`
  2. Show success toast
  3. Invalidate query cache
  4. Log: `[SAVE_PIPELINE] phase=nav`
  5. Navigate to `/products`
- **Transitions**: → COMPLETE

### State 8: PBV2_FLUSH_FAILED
- **Entry**: Draft PUT failed
- **Actions**:
  1. Log: `[SAVE_PIPELINE] phase=pbv2-flush-failed`
  2. Show error toast with retry instructions
  3. **Early return** (no navigation)
- **Transitions**: → COMPLETE

### State 9: PBV2_INVALID
- **Entry**: Tree has nodes but no rootNodeIds
- **Actions**:
  1. Log: `[SAVE_PIPELINE] phase=pbv2-invalid`
  2. Show error toast
  3. **Early return** (no navigation)
- **Transitions**: → COMPLETE

### State 10: SUCCESS_NO_PBV2
- **Entry**: Product saved but no PBV2 tree to flush
- **Actions**:
  1. Log: `[SAVE_PIPELINE] phase=pbv2-skip reason=...`
  2. Show success toast
  3. Invalidate query cache
  4. Navigate to `/products`
- **Transitions**: → COMPLETE

### State 11: MUTATION_ERROR
- **Entry**: API request failed or mutationFn threw
- **Actions**:
  1. Set `saveInFlightRef.current = false` in catch block
  2. Log: `[SAVE_PIPELINE] phase=mutation-error`
  3. TanStack Query calls `onError`
- **Transitions**: → ERROR_HANDLER

### State 12: ERROR_HANDLER
- **Entry**: `onError` called
- **Actions**:
  1. Ensure `saveInFlightRef.current = false` (redundant but safe)
  2. Show error toast
- **Transitions**: → IDLE

### State 13: COMPLETE
- **Entry**: `onSuccess` finally block
- **Actions**:
  1. Set `saveInFlightRef.current = false`
  2. Log: `[SAVE_PIPELINE] phase=complete guard-released`
- **Transitions**: → IDLE

## Error Recovery Paths

### Duplicate Click Prevention
- **Scenario**: User double-clicks Save
- **Prevention**: 
  1. First click sets `saveInFlightRef.current = true`
  2. Second click blocked by guard check in `handleSave`
- **Recovery**: Automatic after first save completes (guard released in finally)

### Network Failure
- **Scenario**: API request fails
- **Flow**: MUTATION_START → MUTATION_ERROR → ERROR_HANDLER → IDLE
- **Recovery**: Guard released in catch block, user can retry

### PBV2 Flush Failure
- **Scenario**: Product saved but draft PUT fails
- **Flow**: ON_SUCCESS → PBV2_FLUSH_START → PBV2_FLUSH_FAILED → COMPLETE → IDLE
- **Recovery**: User stays on page, can click Save again (product will UPDATE, not duplicate)

### Invalid Tree
- **Scenario**: Tree has nodes but no roots
- **Flow**: ON_SUCCESS → PBV2_INVALID → COMPLETE → IDLE
- **Recovery**: User stays on page with error message

## Idempotency Guarantee

### First Save (New Product)
1. `isNewProduct === true`, `createdProductIdRef.current === null`
2. Sends POST `/api/products`
3. Stores `createdProductIdRef.current = productId`
4. Future saves will be UPDATE

### Second Save (Already Created)
1. `isNewProduct === true`, `createdProductIdRef.current !== null`
2. **Converts to UPDATE**: sends PATCH `/api/products/${createdProductIdRef.current}`
3. No duplicate product created

## Key Invariants

1. **Single-Flight**: Only one save can be in progress at a time
2. **Guard Always Released**: Even on error, guard is released in catch/finally
3. **No Navigation on Error**: If PBV2 flush fails, user stays on page
4. **Idempotency**: Once productId exists (created or already exists), always UPDATE
5. **Fresh Snapshot**: PBV2 tree is captured at save time via `getCurrentTree()`, not from stale state

## Log Timeline Example (Success Case)

```
[SAVE_PIPELINE] phase=start mode=create productId=undefined
[SAVE_PIPELINE] phase=create-ok
[SAVE_PIPELINE] phase=pbv2-flush-start productId=prod_123 nodeCount=5 groupCount=1 optionCount=2 edgeCount=3
[SAVE_PIPELINE] phase=pbv2-flush-ok draftId=draft_456
[SAVE_PIPELINE] phase=nav
[SAVE_PIPELINE] phase=complete guard-released
```

## Log Timeline Example (Error Case)

```
[SAVE_PIPELINE] phase=start mode=create productId=undefined
[SAVE_PIPELINE] phase=create-ok
[SAVE_PIPELINE] phase=pbv2-flush-start productId=prod_123 nodeCount=5 groupCount=1 optionCount=2 edgeCount=3
[SAVE_PIPELINE] phase=pbv2-flush-failed
[SAVE_PIPELINE] phase=complete guard-released
```
(User stays on page, can retry)
