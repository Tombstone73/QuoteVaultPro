# PBV2 Figma Audit - Visual Mismatches

## Section-by-Section Analysis

### ✅ CORRECT: Overall Page Structure
- Product sections render above Options Builder ✓
- Sticky header with breadcrumbs/actions ✓
- Natural document scroll flow ✓

---

## ❌ MISMATCH 1: Options Builder Section Header

**Figma Shows:**
- Minimal text label "Options Builder" at section level
- No visible card/container wrapper
- Sits at same hierarchy as other section labels (Basic Information, Pricing Engine)

**Current Code:**
```jsx
<div className="w-full space-y-4">
  <div className="flex items-center justify-between">
    <h2 className="text-base font-medium text-slate-300">Options Builder</h2>
  </div>
  <div className="min-h-[600px] flex border border-[#334155] rounded-lg ...">
```

**Issue:**
- Label styling might not match other section labels
- `space-y-4` between label and content might be too large
- Need to verify label matches Basic Information, Pricing Engine header style

**Fix Required:**
```jsx
<div className="space-y-2">
  <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wide">Options Builder</h3>
  <div className="min-h-[600px] flex border border-[#334155] rounded-lg ...">
```

---

## ❌ MISMATCH 2: Options Builder Height

**Figma Shows:**
- Content-driven height, not fixed
- Appears to be around 800px in screenshot but adjusts to content

**Current Code:**
```jsx
<div className="min-h-[600px] flex border ...">
```

**Issue:**
- Using min-h-[600px] when design system specifies h-[800px]
- Should match DESIGN_SYSTEM.md specification

**Fix Required:**
```jsx
<div className="h-[800px] flex border ...">
```

---

## ❌ MISMATCH 3: Option Groups Sidebar - Badge Styling

**Figma Shows:**
- Very small badges with minimal padding
- Tight spacing between badges
- Badge text appears to be 10px or smaller

**Current Code:**
```jsx
<Badge className="text-[10px] px-1.5 py-0 ...">
```

**Issue:**
- px-1.5 might still be too large
- Need to verify against Figma badge dimensions

**Potential Fix:**
```jsx
<Badge className="text-[10px] px-1 py-0 ...">
```

---

## ❌ MISMATCH 4: Selected Group State

**Figma Shows:**
- Selected "Paper Stock" has blue tint background
- Blue left border accent
- Subtle glow/border

**Current Code:**
```jsx
className={`
  rounded-md transition-colors relative
  ${selectedGroupId === group.id
    ? 'bg-blue-500/10 border border-blue-500/40'
    : 'hover:bg-slate-800/40 border border-transparent'
  }
`}
```

**Issue:**
- Might need left border accent instead of full border
- Check if glow effect is present in Figma

**Potential Fix:**
```jsx
className={`
  rounded-md transition-colors relative
  ${selectedGroupId === group.id
    ? 'bg-blue-500/10 border-l-2 border-l-blue-500 border border-blue-500/30'
    : 'hover:bg-slate-800/40 border border-transparent'
  }
`}
```

---

## ❌ MISMATCH 5: Middle Column - Group Name/Description Inputs

**Figma Shows:**
- Clean input fields with subtle borders
- Description appears as regular textarea, not inline-editable

**Current Code:**
```jsx
<Input
  value={selectedGroup.name}
  onChange={...}
  className="text-base font-semibold mb-2 border-transparent hover:border-slate-600 focus:border-blue-500 px-2 -ml-2 bg-transparent text-slate-100"
/>
<Textarea
  value={selectedGroup.description}
  onChange={...}
  placeholder="Group description..."
  className="text-sm text-slate-300 min-h-[50px] border-transparent hover:border-slate-600 focus:border-blue-500 bg-transparent"
/>
```

**Issue:**
- Invisible border until hover might not match Figma
- Check if Figma shows visible borders by default

**Potential Fix:**
```jsx
<Input
  value={selectedGroup.name}
  className="text-base font-semibold mb-2 border-slate-700 hover:border-slate-600 focus:border-blue-500 bg-[#1e293b] text-slate-100"
/>
<Textarea
  value={selectedGroup.description}
  className="text-sm text-slate-300 min-h-[50px] border-slate-700 hover:border-slate-600 focus:border-blue-500 bg-[#1e293b]"
/>
```

---

## ❌ MISMATCH 6: Options List - Card Styling

**Figma Shows:**
- Option cards with defined borders
- Rounded corners
- Clear visual separation

**Current Code:**
```jsx
<div className="bg-[#1e293b] border border-slate-700 rounded-md overflow-hidden">
```

**Issue:**
- Border color might need adjustment
- Verify rounded-md (6px) matches Figma

**Verify Against:**
- DESIGN_SYSTEM.md says "rounded-md" for cards
- Check if border-[#334155] would be better than border-slate-700

---

## ❌ MISMATCH 7: Pricing Preview Panel - Typography

**Figma Shows:**
- Large dollar amount with clean typography
- Breakdown items with monospace font
- Clean spacing between items

**Current Code:**
```jsx
<span className="text-2xl font-semibold text-slate-100">
  {total.toFixed(2)}
</span>
```

**Issue:**
- Verify text-2xl matches Figma (24px)
- Check if font-mono should be applied to dollar amount

---

## ❌ MISMATCH 8: Section Spacing

**Figma Shows:**
- Consistent vertical rhythm between sections
- Appears to be 16px between major sections

**Current Code:**
```jsx
<div className="p-6 space-y-4">
  <ProductForm ... />
  <PBV2ProductBuilderSectionV2 ... />
</div>
```

**Issue:**
- space-y-4 = 16px ✓ CORRECT
- But verify p-6 (24px) matches Figma outer padding

---

## ❌ MISMATCH 9: Option Row Collapsed State

**Figma Shows:**
- Collapsed options show: grip handle, name, description (truncated), badges
- Expand icon on right
- Compact vertical spacing

**Current Code:**
```jsx
<div className="flex items-center p-4 hover:bg-slate-800/30 transition-colors">
  <GripVertical className="h-4 w-4 text-slate-500 mr-2 flex-shrink-0" />
  <button type="button" onClick={...} className="flex-1 flex items-center gap-3">
    ...
  </button>
  ...
</div>
```

**Issue:**
- p-4 might be too large (should be p-3 based on density in Figma)
- Verify badge placement matches Figma

**Fix Required:**
```jsx
<div className="flex items-center p-3 hover:bg-slate-800/30 transition-colors">
```

---

## ❌ MISMATCH 10: Add Group / Add Option Buttons

**Figma Shows:**
- Blue primary buttons
- Full width in sidebar
- Icon + text

**Current Code:**
```jsx
<Button
  onClick={onAddGroup}
  className="w-full gap-2 bg-blue-600 hover:bg-blue-700 text-white"
  size="sm"
>
  <Plus className="h-4 w-4" />
  Add Group
</Button>
```

**Issue:**
- ✓ CORRECT - Matches Figma

---

## Priority Fixes (Highest Impact)

### 1. **Fix Options Builder Height**
Change `min-h-[600px]` → `h-[800px]` to match design system

### 2. **Fix Section Header Style**
Match other section headers (Basic Information style)

### 3. **Fix Input Field Borders**
Make borders visible by default if Figma shows them

### 4. **Verify Badge Sizes**
Ensure text-[10px] and padding match Figma exactly

### 5. **Fix Option Row Padding**
Reduce p-4 → p-3 for collapsed option cards

---

## Files Requiring Changes

1. **PBV2ProductBuilderLayout.tsx**
   - Fix section header style
   - Fix height to h-[800px]

2. **OptionEditor.tsx**
   - Fix input field border visibility
   - Fix option row padding

3. **OptionGroupsSidebar.tsx**
   - Verify badge padding (might reduce to px-1)

4. **PricingValidationPanel.tsx**
   - Verify typography matches Figma

---

## Changes NOT Required

✅ Column widths (w-72, w-96) - Already correct
✅ Overall layout structure - Already correct  
✅ Color palette - Already using correct colors
✅ Border colors - Mostly correct
✅ Add buttons styling - Already correct
✅ Scroll behavior - Already correct

---

## Next Steps

Apply fixes in order of priority:
1. Height fix (quick win)
2. Section header style (important for hierarchy)
3. Input borders (important for usability)
4. Padding/spacing refinements (polish)
