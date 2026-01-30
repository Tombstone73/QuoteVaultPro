# PBV2 JSON Import/Export - Implementation Complete

## SUMMARY
Re-exposed PBV2 JSON import/export functionality with enterprise-safe guardrails. This is a UI-only implementation that reuses existing backend validation logic.

## CHANGES

### Component Modified
**File:** `client/src/components/PBV2ProductBuilderSection.tsx`

#### Added State Variables (lines ~240)
```typescript
const [jsonImportModalOpen, setJsonImportModalOpen] = useState(false);
const [jsonImportText, setJsonImportText] = useState("");
const [jsonImportValidated, setJsonImportValidated] = useState(false);
const [jsonImportFindings, setJsonImportFindings] = useState<Finding[]>([]);
const [jsonImportError, setJsonImportError] = useState("");
```

#### Added Imports
- DropdownMenu components from shadcn/ui
- Icons: Download, Upload, AlertTriangle, CheckCircle2, Info from lucide-react

#### Added Functions (lines ~620-740)
1. **downloadJson(source: "draft" | "active")**: Exports PBV2 JSON to file
   - Uses existing `stringifyPbv2TreeJson` utility
   - Filename format: `pbv2_draft_${productId}.json` or `pbv2_published_${productId}.json`
   - Creates blob and triggers browser download

2. **validateJsonImport()**: Validates uploaded JSON
   - Uses existing `validateTreeForPublish` from shared validator
   - Sets findings (errors/warnings) and validation state
   - Handles JSON parse errors gracefully

3. **applyJsonImportMutation**: TanStack Query mutation to apply JSON
   - Creates Draft if none exists (POST `/api/products/:id/pbv2/tree/draft`)
   - Updates Draft if exists (PATCH `/api/pbv2/tree-versions/:id`)
   - Refetches tree data after success
   - Shows toast notifications
   - Closes modal on success

#### Updated Header UI (lines ~1260)
Added two new action buttons:
- **Download JSON dropdown**: Export Draft or Published JSON
  - Disabled if no Draft and no Active version
  - Menu items individually disabled based on availability
- **Upload JSON button**: Opens import modal
  - Always enabled to allow user to prepare JSON

#### Added Import Modal (lines ~3530-3660)
Full-featured Dialog component with:
- Warning banner explaining Safe Draft workflow
- Textarea for JSON paste (200px height, monospace font)
- Validate button (disabled after successful validation)
- Validation error display (red, pre-formatted)
- Validation findings list (color-coded by severity: ERROR=red, WARNING=amber, INFO=blue)
- Success message (green banner)
- Apply to Draft button:
  - Disabled until validated
  - Disabled if parse errors exist
  - Disabled if ERROR severity findings exist
  - Shows "Applying..." while mutation pending

## SAFETY GUARDRAILS

### 1. Draft-Only Mutation
- JSON import ONLY affects Draft version
- Published version remains untouched until explicit Publish action
- Modal warning banner clearly explains this workflow

### 2. Validation Before Apply
- Must click "Validate JSON" before "Apply to Draft" is enabled
- Validation uses production `validateTreeForPublish` logic
- Parse errors block Apply button
- ERROR findings block Apply button
- WARNING findings allow Apply (user decision)

### 3. Explicit Confirmation Required
- Two-step process: Validate → Apply
- Modal shows all findings before applying
- User must click "Apply to Draft" to proceed
- No auto-apply or silent imports

### 4. Clear Visual Feedback
- Color-coded severity indicators (red/amber/blue)
- Icon indicators for each finding
- Success/error banners
- Loading states on buttons

## TESTING PLAN

### Manual Testing
1. **Download Draft JSON**
   - Navigate to product with PBV2 Draft
   - Click "Download JSON" → "Export Draft"
   - Verify JSON file downloads with correct filename
   - Open JSON and verify structure matches Draft

2. **Download Published JSON**
   - Navigate to product with Published PBV2
   - Click "Download JSON" → "Export Published"
   - Verify JSON file downloads with correct filename
   - Open JSON and verify structure matches Published

3. **Upload Valid JSON**
   - Click "Upload JSON"
   - Paste valid PBV2 JSON (from downloaded file)
   - Click "Validate JSON"
   - Verify green success banner appears
   - Click "Apply to Draft"
   - Verify toast notification shows success
   - Verify Draft updates in UI

4. **Upload Invalid JSON**
   - Click "Upload JSON"
   - Paste malformed JSON (syntax error)
   - Click "Validate JSON"
   - Verify red error banner shows parse error
   - Verify "Apply to Draft" button is disabled

5. **Upload JSON with Validation Errors**
   - Click "Upload JSON"
   - Paste JSON with schema violations (e.g., missing required fields)
   - Click "Validate JSON"
   - Verify findings list shows ERROR items in red
   - Verify "Apply to Draft" button is disabled

6. **Upload JSON with Warnings**
   - Click "Upload JSON"
   - Paste JSON with non-blocking issues
   - Click "Validate JSON"
   - Verify findings list shows WARNING items in amber
   - Verify "Apply to Draft" button is enabled
   - Click Apply and verify Draft updates

7. **Create Draft via Import**
   - Navigate to product with NO Draft (only Published)
   - Download Published JSON
   - Modify JSON slightly (change a label)
   - Upload and validate modified JSON
   - Apply to Draft
   - Verify new Draft is created (not Published mutated)

8. **Modal Close/Cancel**
   - Open Upload modal
   - Paste JSON and validate
   - Click "Cancel"
   - Verify modal closes
   - Reopen modal - verify state is reset

### TypeScript Check
✅ `npm run check` passes with no errors

### API Smoke Tests
No new backend endpoints - reuses existing:
- `GET /api/products/:id/pbv2/tree` (fetches Draft/Active)
- `POST /api/products/:id/pbv2/tree/draft` (creates Draft)
- `PATCH /api/pbv2/tree-versions/:id` (updates Draft)

## REUSED EXISTING PATTERNS

### Backend Validation
- Uses `validateTreeForPublish` from `shared/pbv2/validator.ts`
- Same validation logic as Publish button uses
- Consistent error/warning messages

### JSON Serialization
- Uses `stringifyPbv2TreeJson` utility
- Same format as existing JSON editor uses
- Preserves all tree structure and metadata

### Mutation Patterns
- Follows existing TanStack Query patterns in component
- Same API endpoints as manual Draft creation/updates
- Consistent error handling with toast notifications

### UI Components
- Uses existing shadcn/ui Dialog, Button, DropdownMenu
- Follows TitanOS theme variables (text-primary, bg-card, etc.)
- Matches existing modal patterns (Delete Draft, etc.)

## NOTES

### Safe Edit Mode Integration
- Removed conditional `inSafeEditMode` check (not a state variable)
- Modal always shows "Safe Draft Workflow" warning
- Behavior: JSON import inherently only affects Draft (safe by design)

### Severity Enum Fix
- Validator returns uppercase severity: "ERROR", "WARNING", "INFO"
- Fixed modal to use uppercase comparisons for icon/color selection
- Fixed Apply button disabled logic to check "ERROR" not "error"

### Dropdown Button Logic
- Download dropdown disabled if no Draft AND no Active
- Individual menu items disabled independently:
  - "Export Draft" disabled if no Draft
  - "Export Published" disabled if no Active
- Upload button always enabled (no prerequisites)

### Future Enhancements (NOT IMPLEMENTED)
- Diff preview showing before/after changes
- Bulk import for multiple products
- Version history comparison
- JSON schema documentation link
- Import from file (currently paste-only)

## ACCEPTANCE CRITERIA ✅

1. ✅ Owner/Admin can download Draft PBV2 JSON
2. ✅ Owner/Admin can download Published PBV2 JSON
3. ✅ Owner/Admin can upload JSON via modal
4. ✅ JSON validation happens before apply (explicit button)
5. ✅ Validation errors block apply
6. ✅ Validation warnings allow apply (user decision)
7. ✅ Apply only affects Draft (never Published)
8. ✅ Clear visual feedback (color-coded severity, banners)
9. ✅ Auto-creates Draft if needed on import
10. ✅ Modal requires explicit confirmation to apply
11. ✅ TypeScript checks pass
12. ✅ Reuses existing backend validation logic

## DEPLOYMENT NOTES

### No Migration Required
- UI-only changes
- No schema modifications
- No new API endpoints

### Rollback Plan
If issues arise, simply revert `PBV2ProductBuilderSection.tsx` to previous version.

### Monitoring
Watch for:
- Toast notifications about JSON import failures
- User reports of validation false positives
- Performance issues with large JSON files (10k+ nodes)

---
**Status:** READY FOR TESTING
**TypeScript:** ✅ PASSING
**Risk Level:** LOW (UI-only, reuses existing backend)
