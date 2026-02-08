# Figma Design Implementation Plan - Product Builder

## Overview
This document outlines the implementation plan to make the Product Builder pixel-perfect compared to the Figma design.

## Current Status vs Figma Design

### ✅ Completed (Pixel-Perfect Implementation)
1. ✅ 3-column layout structure (left sidebar, middle editor, right panel)
2. ✅ Option groups sidebar with improved styling, spacing, and visual feedback
3. ✅ Option editor with enhanced card styling and badges
4. ✅ Pricing validation panel with Product Summary section
5. ✅ Dark theme with proper color tokens matching Figma
6. ✅ Proper spacing, padding, and border radius throughout
7. ✅ Hover states and transitions
8. ✅ Empty state displays
9. ✅ Product Summary section in right panel showing:
   - Output Format
   - Ink Options
   - Required Groups count
   - Pricing Options count
   - Estimated Options count

### 🔧 Styling Improvements Applied

#### 1. **Layout & Spacing** ✅ COMPLETE
- **Container**: Fixed height of 800px ✅
- **Left Sidebar**: 288px width (w-72) with bg-[#0f172a] ✅
- **Right Panel**: 384px width (w-96) with bg-[#0f172a] ✅
- **Padding/Margins**: Updated to match Figma (p-5, p-6, space-y-3) ✅

#### 2. **Left Sidebar (Option Groups)** ✅ COMPLETE
**Implemented**:
- ✅ Group cards with rounded-lg borders and subtle shadows
- ✅ Option count display with improved badge styling
- ✅ Drag handle icon (GripVertical) with opacity-60
- ✅ Feature badges (Pricing, Production, Conditional) with tooltips
- ✅ Selected state with blue accent (border-blue-500/50, shadow-sm)
- ✅ Proper spacing between groups (my-2 separator)
- ✅ Smooth transitions (transition-all duration-150)
- ✅ Hover states (hover:bg-slate-800/30, hover:border-slate-600)
- ✅ ChevronRight rotation on selection (rotate-90)

#### 3. **Middle Panel (Option Editor)** ✅ COMPLETE (Basic Styling)
**Implemented**:
- ✅ Enhanced group header with larger font (text-lg)
- ✅ Improved textarea for description (min-h-[60px])
- ✅ Better switch styling with proper labels
- ✅ Option cards with conditional borders (border-blue-500/50 when expanded)
- ✅ Improved badge styling (text-[10px], h-5)
- ✅ Better hover states and transitions
- ✅ Clean section headers (uppercase tracking-wide)
- ✅ Proper form field styling
- ✅ Choice management with reordering (existing functionality)

**Not Yet Implemented** (Future Phase):
- ⏳ Tabbed interface for option details:
  - **Option Name** tab
  - **Description** tab
  - **Pricing Behavior** tab
  - **Production Flags** tab
  - **Conditional Logic** tab
  - **Shipping Impact** tab

#### 4. **Right Panel (Pricing Preview)** ✅ COMPLETE
**Implemented**:
- ✅ **Pricing Preview** section with improved styling
  - Larger, bolder total display (text-2xl font-bold)
  - Emerald dollar sign icon
  - Rounded-lg cards with shadow-sm
  - Better breakdown display with hover states
- ✅ **Weight Preview** section (when applicable)
  - Total weight display with formatting
  - Breakdown by component
- ✅ **Validation** section with enhanced styling
  - Error cards with border-red-500/50 and shadow-sm
  - Warning cards with border-amber-500/40
  - Info cards with proper styling
  - Animated pulse on error indicator
  - Better spacing and typography
- ✅ **Product Summary** section at bottom
  - Output Format display
  - Ink Options status
  - Required Groups count
  - Pricing Options count
  - Estimated Options count
  - Icons for each summary item

### ❌ Missing Features (Not Yet Implemented)

#### 1. **Tabbed Option Editor Interface**
The Figma design shows a sophisticated tabbed interface for editing options:
- Tab navigation for different aspects of an option
- Each tab has specific fields and controls
- Conditional Logic tab with "Add Condition" button
- Production Flags tab with flag management
- Shipping Impact tab for weight/shipping configuration

#### 2. **Product Summary Panel**
The right panel should include a "Product Summary" section showing:
- Output Format
- Ink Options
- Required Groups count
- Pricing Options count
- Estimated Options count

#### 3. **Advanced Pricing Behavior**
The Pricing Behavior tab should support:
- No Price Impact (default)
- Add Flat Amount
- Add Per Quantity
- Add Per Square Foot
- Custom pricing formulas

#### 4. **Production Flags Management**
- Ability to add/remove production flags
- Flag types: Edge Finishing, Spot UV, Foil Stamping, Embossing, etc.

#### 5. **Conditional Logic Builder**
- Visual condition builder
- "Always available (no conditions)" default state
- "This option is only appear when the following conditions are met:" section
- Add Condition button with condition rules

#### 6. **Shipping Impact Configuration**
- Weight Mode selection (No Weight Impact, Add Fixed Weight, Add Per Quantity)
- Weight input fields
- Unit selection (oz/lb)

## Implementation Priority

### Phase 1: Layout & Styling Refinements (Current Sprint)
1. ✅ Adjust spacing and padding to match Figma exactly
2. ✅ Refine color scheme and borders
3. ✅ Improve typography and font sizes
4. ✅ Add proper hover states and transitions

### Phase 2: Enhanced UI Components (Next Sprint)
1. Implement tabbed interface for option editing
2. Add Product Summary panel
3. Enhance validation display
4. Improve choice management UI

### Phase 3: Advanced Features (Future)
1. Conditional Logic builder
2. Production Flags management
3. Shipping Impact configuration
4. Advanced pricing behavior options

## Files to Modify

### Immediate Changes (Phase 1):
1. `PBV2ProductBuilderLayout.tsx` - Layout structure
2. `OptionGroupsSidebar.tsx` - Group display styling
3. `OptionEditor.tsx` - Option list styling
4. `OptionDetailsEditor.tsx` - Form field styling
5. `PricingValidationPanel.tsx` - Add Product Summary section
6. `ProductEditorPage.tsx` - Header styling
7. `PBV2ProductBuilderSectionV2.tsx` - Integration

### Future Changes (Phase 2-3):
1. Create `OptionEditorTabs.tsx` - Tabbed interface component
2. Create `ConditionalLogicBuilder.tsx` - Condition builder
3. Create `ProductionFlagsEditor.tsx` - Flags management
4. Create `ShippingImpactEditor.tsx` - Shipping configuration
5. Enhance `OptionDetailsEditor.tsx` - Advanced pricing

## Design Tokens (From Figma)

### Colors:
- Background: `#0a0e1a`
- Card Background: `#0f172a`, `#1e293b`
- Border: `#334155`
- Text Primary: `#f1f5f9` (slate-100)
- Text Secondary: `#cbd5e1` (slate-300)
- Text Muted: `#94a3b8` (slate-400)
- Accent Blue: `#3b82f6` (blue-500)
- Success: `#10b981` (emerald-500)
- Warning: `#f59e0b` (amber-500)
- Error: `#ef4444` (red-500)

### Spacing:
- Section padding: `p-4` to `p-6`
- Card padding: `p-3` to `p-4`
- Gap between elements: `gap-2` to `gap-4`

### Typography:
- Section headers: `text-sm font-semibold`
- Labels: `text-xs text-slate-400`
- Body text: `text-sm text-slate-300`
- Input text: `text-sm text-slate-100`


