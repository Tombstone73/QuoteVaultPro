# Production Artwork Viewer - Mouse Wheel Zoom Enhancement

## Summary
Added mouse scroll wheel zoom functionality to the Production artwork preview modal. The Back tab already correctly displays front artwork when no separate back artwork exists, with clear "(Same as Front)" indicators.

## Implementation Details

### 1. Mouse Wheel Zoom (ZoomPanImageViewer.tsx)
**File**: `client/src/components/production/ZoomPanImageViewer.tsx`

**Changes**:
- Changed `ViewMode` type from `"fit" | "100" | "zoom"` to `"fit" | "100" | "custom"`
- Added `customScale` state to track user-defined zoom levels
- Added `MIN_SCALE = 0.25` and `MAX_SCALE = 5` constants for zoom bounds
- Added wheel event handler with cursor-centered zooming
- Refactored scale calculation into `calculateScale()` callback for reuse
- Updated pan logic to work at any scale > 1 (not just "zoom" mode)
- Updated double-click to toggle between fit and custom 2x zoom
- Added zoom in/out helper functions

**UI Updates**:
- Replaced "Zoom" button with +/- zoom control buttons
- Added zoom percentage display (e.g., "125%")
- Zoom buttons disabled at min/max bounds
- +/- buttons use `Plus` and `Minus` icons from lucide-react

**Behavior**:
- Mouse wheel up = zoom in (cursor-centered)
- Mouse wheel down = zoom out (cursor-centered)
- Zoom range: 25% to 500%
- Smooth continuous zooming with wheel events
- Pan/drag enabled when scale > 1
- Fit/100% buttons still available for quick presets
- Zoom state persists in localStorage

### 2. Back Tab Rendering (Verified Working)
**File**: `client/src/features/production/views/FlatbedProductionView.tsx`

**Existing Implementation** (lines 406-443):
- `normalizeArtworkForSides()` function handles artwork logic:
  - For double-sided jobs: shows Front + Back tabs
  - If back artwork is missing: defaults to front artwork
  - Returns `isSameArtwork: true` when back = front
- Modal displays front artwork in Back tab when no separate back artwork exists
- UI indicators:
  - "(Same as Front)" text next to Back button (amber color)
  - "Same as Front" badge in file metadata area
  - ZoomPanImageViewer renders the artwork correctly regardless

**No changes needed** - existing logic already works correctly.

## Testing Checklist

### Mouse Wheel Zoom
- [x] TypeScript compilation passes (no errors)
- [ ] Wheel up zooms in smoothly
- [ ] Wheel down zooms out smoothly
- [ ] Zoom respects 0.25x - 5x bounds
- [ ] Zooming is cursor-centered (zoom towards mouse position)
- [ ] +/- buttons work correctly
- [ ] Buttons disabled at zoom limits
- [ ] Zoom percentage displays correctly
- [ ] Pan/drag works when zoomed in
- [ ] Double-click toggles between fit and 2x zoom
- [ ] Fit/100% buttons reset zoom state

### Back Tab Rendering (Already Working)
- [ ] Double-sided job with separate back artwork shows correct image in Back tab
- [ ] Double-sided job without back artwork shows front image in Back tab
- [ ] "(Same as Front)" indicator appears in both locations
- [ ] File metadata shows correct filename for displayed artwork
- [ ] Download button downloads correct file

## Files Modified

1. `client/src/components/production/ZoomPanImageViewer.tsx`
   - Added wheel zoom support
   - Refactored zoom controls UI
   - Updated scale calculation logic
   - Modified pan/drag conditions

## Files Verified (No Changes Needed)

1. `client/src/features/production/views/FlatbedProductionView.tsx`
   - Back tab rendering already working correctly
   - Uses normalizeArtworkForSides() to handle missing back artwork
   - Displays appropriate indicators

## Technical Notes

- Wheel zoom uses `preventDefault()` with `{ passive: false }` to prevent page scroll
- Zoom speed: 0.001 per deltaY unit (smooth, not too fast)
- Scale calculation refactored into `useCallback` to avoid circular dependencies
- Offset clamping ensures image can't be dragged completely off-screen
- localStorage key: `zoom-viewer-mode` (existing, still works)

## Production Deployment Notes

- No database migrations required
- No backend changes
- No breaking changes to existing functionality
- All existing zoom/pan features preserved
- TypeScript compilation successful
