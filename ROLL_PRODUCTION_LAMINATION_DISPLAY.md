# Roll Production Detail View + Lamination Display

## Summary
Added lamination/finish display to Roll production job detail pages. The lamination information is derived from line item `selectedOptions` (preferred) or order/line item notes (fallback), with no database changes required.

## Implementation

### 1. Production Helpers Library
**File**: `client/src/lib/productionHelpers.ts`

New utility functions:
- **`deriveLaminationDisplay()`**: Derives lamination type from structured options or notes
  - Priority: `selectedOptions` → notes text search → "none"
  - Returns: `{ kind, label, source }` object
  - Kinds: `gloss`, `matte`, `textured_floor`, `custom`, `none`
  - Sources: `option` (from selectedOptions), `note` (from text search), `unknown` (not found)

- **`isRollJob(stationKey)`**: Detects if job is roll-based
- **`isFlatbedJob(stationKey)`**: Detects if job is flatbed-based  
- **`formatDimensions()`**: Formats dimensions with roll-aware logic

### 2. Production Job Detail Page Updates
**File**: `client/src/pages/production-job-detail.tsx`

**Changes**:
1. Import production helpers
2. Add `lamination` useMemo that:
   - Only computes for Roll jobs (detected via `stationKey`)
   - Extracts `primaryLineItem` from `data.order.lineItems`
   - Calls `deriveLaminationDisplay()` with line item + notes
3. Display lamination badge in Job Specifications card:
   - Only shows for Roll jobs (`lamination` is null for non-Roll)
   - Color-coded badge:
     - **Gloss**: Blue (`bg-blue-500`)
     - **Matte**: Slate (`bg-slate-500`)
     - **Textured Floor (Anti-slip)**: Amber (`bg-amber-500`)
     - **Custom (see notes)**: Purple (`bg-purple-500`)
     - **None/Unknown**: Outline variant (`—`)
   - Shows source indicator: `(from notes)` when derived from text search

## Display Logic

### Lamination Detection (Priority Order)
1. **Structured Options** (most reliable):
   - Searches `lineItem.selectedOptions` for options with names containing:
     - "lamination", "laminat", "finish", "coating"
   - Parses `value` and `note` fields for keywords:
     - "gloss" → Gloss
     - "matte"/"mat " → Matte
     - "textured"/"floor"/"anti-slip" → Textured Floor (Anti-slip)
     - "custom"/"see note"/"special" → Custom (see notes)

2. **Notes Text Search** (fallback):
   - Searches order/line item notes for lamination keywords
   - Less reliable but catches unstructured data

3. **Not Found**:
   - Returns `{ kind: "none", label: "—", source: "unknown" }`
   - **Always displays field** (never hidden) - shows "—" when no data

### Roll Job Detection
- Uses `stationKey` field from production job
- Matches: `"roll"` (case-insensitive, includes partial matches)
- Non-Roll jobs: Lamination field not displayed

## UI Placement

**Job Specifications Card** (right column, below thumbnails):
```
Sides: Single
Lamination: [GLOSS BADGE] (from notes)  ← NEW for Roll jobs only
Station: roll
```

## Testing

### Manual Testing Steps
1. Navigate to Production Board: `/production`
2. Click on a Roll job card (stationKey = "roll")
3. Verify Job Specifications card shows:
   - "Lamination:" label
   - Color-coded badge with appropriate label
   - Source indicator if derived from notes
4. Test scenarios:
   - Roll job with lamination option → Shows correct badge
   - Roll job without lamination → Shows "—"
   - Flatbed job → Lamination field not shown

### Test Cases
- ✅ **Roll job with structured lamination option**: Badge shows correct type
- ✅ **Roll job with lamination in notes**: Badge shows with "(from notes)" indicator
- ✅ **Roll job without lamination**: Shows "—"
- ✅ **Flatbed job**: Lamination field hidden
- ✅ **TypeScript compilation**: Passes `npx tsc --noEmit`

## Data Flow

```
Backend API: GET /api/production/jobs/:jobId
  ↓
Returns: {
  stationKey: "roll",
  order: {
    lineItems: {
      primary: {
        selectedOptions: [
          { optionName: "Lamination", value: "gloss", ... }
        ]
      }
    }
  }
}
  ↓
Frontend: production-job-detail.tsx
  ↓
isRollJob(stationKey) → true
  ↓
deriveLaminationDisplay({ lineItem, notes })
  ↓
Display: <Badge>Gloss</Badge>
```

## Technical Details

### No Database Changes
- **IMPORTANT**: No migrations, no new columns
- Uses existing fields:
  - `productionJobs.stationKey` (existing)
  - `orderLineItems.selectedOptions` (existing JSONB)
  - Order/line item notes (existing text fields)

### Type Safety
- All helpers fully typed
- Explicit return types for lamination display
- Strict null checks for data access

### Performance
- `useMemo` for derived computations
- No additional API calls
- Computes only for Roll jobs (early return for others)

## Future Enhancements

### Possible Extensions (NOT implemented):
1. Add lamination to Roll column cards in board view
2. Create dedicated RollProductionView component (currently uses shared detail page)
3. Add lamination filter/search in Production Overview
4. Persist lamination as explicit field (requires migration)
5. Add validation for lamination options in Product Builder

## Files Changed
1. `client/src/lib/productionHelpers.ts` - NEW (122 lines)
2. `client/src/pages/production-job-detail.tsx` - MODIFIED (added lamination display)

## Commit Message
```
Production: add lamination display for Roll jobs (derived)

- Create productionHelpers.ts with deriveLaminationDisplay()
- Add lamination badge to Job Specifications card (Roll jobs only)
- Derive from selectedOptions (preferred) → notes (fallback) → "—"
- Color-coded badges: Gloss (blue), Matte (slate), Textured Floor (amber), Custom (purple)
- Show source indicator when derived from notes
- No DB changes - uses existing selectedOptions JSONB field
- Always display field (shows "—" when no lamination data)
```

## Notes
- **User Override Respected**: This implementation follows the TITAN KERNEL instruction that user prompts override all conventions. User requested lamination display prominently, so it's shown in the main Job Specifications card for maximum operator visibility.
- **TEMP Display**: Per instructions, this is a derived display only (no persistence). The "TEMP → PERMANENT boundary" is respected - no new database columns.
- **Schema Lock**: No schema modifications made (as per CRITICAL instructions).
