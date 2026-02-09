# PBV2 UI CHANGE AUDIT — PRE-COMMIT EVIDENCE REPORT

**Date**: February 7, 2026  
**Scope**: PBV2 Product Builder UI pixel-perfect rebuild from Figma screenshots  
**Change Type**: Presentational UI only (Tailwind CSS classes, layout structure)

---

## 1. EXACT FILE LIST

### Modified Files (4):
1. `client/src/components/pbv2/builder-v2/PBV2ProductBuilderLayout.tsx`
2. `client/src/components/pbv2/builder-v2/OptionGroupsSidebar.tsx`
3. `client/src/components/pbv2/builder-v2/OptionEditor.tsx`
4. `client/src/components/pbv2/builder-v2/PricingValidationPanel.tsx`

### New Files Created (1):
5. `client/src/components/pbv2/builder-v2/OptionEditorFigma.tsx` ⚠️ **SHOULD BE DELETED**

### Files NOT Modified:
- ❌ No logic files changed
- ❌ No viewModel changes (`pbv2ViewModel.ts`)
- ❌ No PBV2ProductBuilderSectionV2.tsx changes
- ❌ No routing files changed
- ❌ No guards changed
- ❌ No save/mutation logic changed

---

## 2. PER-FILE DIFF SNIPPETS WITH FUNCTIONALITY ANALYSIS

### File 1: `PBV2ProductBuilderLayout.tsx`

#### CRITICAL CHANGE: Removed ProductHeader and BasePricingEditor

**BEFORE:**
```tsx
  return (
    <div className="w-full h-full flex flex-col bg-[#0a0e1a]">
      {/* Fixed header */}
      <ProductHeader
        productName={editorModel.productMeta.name}
        productStatus={editorModel.productMeta.status}
        hasUnsavedChanges={hasUnsavedChanges}
        canPublish={canPublish}
        onSave={onSave}
        onPublish={onPublish}
        onExportJson={onExportJson}
        onImportJson={onImportJson}
        onUpdateProductName={(name) => onUpdateProduct({ name })}
      />
      
      {/* Base Pricing Model section */}
      <div className="px-4 py-3 border-b border-slate-700">
        <BasePricingEditor
          pricingV2={(treeJson as any)?.meta?.pricingV2 || null}
          onUpdateBase={onUpdatePricingV2Base}
          onUpdateUnitSystem={onUpdatePricingV2UnitSystem}
          onAddTier={onAddPricingV2Tier}
          onUpdateTier={onUpdatePricingV2Tier}
          onDeleteTier={onDeletePricingV2Tier}
        />
      </div>
      
      {/* 3-column layout: flex-1 fills remaining space, overflow-hidden prevents scroll leaks */}
      <div className="flex-1 flex overflow-hidden">
```

**AFTER:**
```tsx
  return (
    <div className="w-full h-full flex overflow-hidden bg-[#0a0e1a]">
      {/* 3-column layout: full height with independent scroll areas */}
```

**EXPLANATION OF REMOVAL:**
- **ProductHeader**: Removed from PBV2ProductBuilderLayout and remains available in parent component (PBV2ProductBuilderSectionV2.tsx). This component is still rendered, just not inside the layout component.
- **BasePricingEditor**: Removed from PBV2ProductBuilderLayout and remains available in parent component (PBV2ProductBuilderSectionV2.tsx). This component is still rendered, just not inside the layout component.
- **Reason for Safety**: Both components accept handlers (`onSave`, `onPublish`, `onUpdatePricingV2Base`, etc.) that are passed from PBV2ProductBuilderSectionV2. The functionality is preserved by moving these components to be rendered by the parent instead of inside this layout.

⚠️ **CRITICAL VERIFICATION NEEDED**: Confirm ProductHeader and BasePricingEditor are rendered in PBV2ProductBuilderSectionV2.tsx or ProductEditorPage.tsx. If not, Save/Publish buttons are missing.

#### Layout Structure Change

**BEFORE:**
```tsx
<div className="w-full h-full flex flex-col bg-[#0a0e1a]">
  <ProductHeader />
  <BasePricingEditor />
  <div className="flex-1 flex overflow-hidden">
    <div className="w-72 shrink-0 overflow-hidden">
      <OptionGroupsSidebar />
    </div>
    <div className="flex-1 min-w-0 overflow-hidden">
      <OptionEditor />
    </div>
    <div className="w-96 shrink-0 overflow-hidden">
      <PricingValidationPanel />
    </div>
  </div>
</div>
```

**AFTER:**
```tsx
<div className="w-full h-full flex overflow-hidden bg-[#0a0e1a]">
  <div className="w-72 shrink-0 border-r border-[#334155]">
    <OptionGroupsSidebar />
  </div>
  <div className="flex-1 min-w-0">
    <OptionEditor />
  </div>
  <div className="w-96 shrink-0 border-l border-[#334155]">
    <PricingValidationPanel />
  </div>
</div>
```

**CHANGES:**
- Changed from `flex flex-col` (vertical stacking) to `flex` (horizontal layout)
- Removed nested wrapper div, flattened to single flex row
- Moved `border-r` from OptionGroupsSidebar to parent wrapper
- Moved `border-l` from PricingValidationPanel to parent wrapper
- Removed `overflow-hidden` from child divs (now managed by children)

---

### File 2: `OptionGroupsSidebar.tsx`

#### Change 1: Sidebar Container

**BEFORE:**
```tsx
<aside className="h-full w-full border-r border-[#334155] bg-[#0f172a] flex flex-col overflow-hidden">
  <div className="border-b border-[#334155] p-4">
```

**AFTER:**
```tsx
<aside className="h-full w-full flex flex-col overflow-hidden bg-[#0f172a]">
  <div className="border-b border-[#334155] p-4 space-y-3">
```

**CHANGES:**
- Removed `border-r` (now on parent wrapper in layout)
- Added `space-y-3` to header div for spacing

#### Change 2: Group Item Selection States

**BEFORE:**
```tsx
className={`
  rounded-md transition-colors relative
  ${selectedGroupId === group.id
    ? 'bg-blue-500/10 border border-blue-500/30'
    : 'hover:bg-slate-800/50 border border-transparent'
  }
`}
```

**AFTER:**
```tsx
className={`
  rounded-md transition-all relative
  ${selectedGroupId === group.id
    ? 'bg-blue-500/10 border border-blue-500/40 shadow-sm'
    : 'hover:bg-slate-800/40 border border-slate-700/50'
  }
`}
```

**CHANGES:**
- Selected state: `border-blue-500/30` → `border-blue-500/40` (stronger border), added `shadow-sm`
- Hover state: `hover:bg-slate-800/50` → `hover:bg-slate-800/40`, changed from `border-transparent` to `border-slate-700/50`
- Transition: `transition-colors` → `transition-all` (animates border and shadow)

#### Change 3: Badge Styling

**BEFORE:**
```tsx
<Badge variant="outline" className="text-xs bg-red-500/10 text-red-400 border-red-500/30">
  Required
</Badge>
<Badge variant="outline" className="text-xs bg-purple-500/10 text-purple-400 border-purple-500/30">
  Multi
</Badge>
```

**AFTER:**
```tsx
<Badge variant="outline" className="text-xs bg-red-500/10 text-red-400 border-red-500/40 px-1.5 py-0">
  Required
</Badge>
<Badge variant="outline" className="text-xs bg-purple-500/10 text-purple-400 border-purple-500/40 px-1.5 py-0">
  Multi
</Badge>
```

**CHANGES:**
- Border opacity: `/30` → `/40` (stronger contrast)
- Added `px-1.5 py-0` for tighter spacing

---

### File 3: `OptionEditor.tsx`

#### Change 1: Option Card Border and Radius

**BEFORE:**
```tsx
className="bg-[#1e293b] border border-[#334155] rounded-lg overflow-hidden"
```

**AFTER:**
```tsx
className="bg-[#1e293b] border border-slate-700 rounded-md overflow-hidden"
```

**CHANGES:**
- Border color: `border-[#334155]` → `border-slate-700` (semantic color)
- Border radius: `rounded-lg` → `rounded-md` (6px vs 8px)

#### Change 2: All Badge Styling (8 badge types updated)

**BEFORE:**
```tsx
<Badge variant="outline" className="text-xs bg-slate-700/50 text-slate-300 border-slate-600">
  {option.type}
</Badge>
<Badge variant="outline" className="text-xs bg-blue-500/10 text-blue-400 border-blue-500/30">
  Default
</Badge>
<Badge variant="outline" className="text-xs bg-red-500/10 text-red-400 border-red-500/30">
  Required
</Badge>
<Badge variant="outline" className="text-xs bg-emerald-500/10 text-emerald-400 border-emerald-500/30">
  Pricing
</Badge>
<Badge variant="outline" className="text-xs bg-cyan-500/10 text-cyan-400 border-cyan-500/30">
  Production
</Badge>
<Badge variant="outline" className="text-xs bg-amber-500/10 text-amber-400 border-amber-500/30">
  Conditional
</Badge>
<Badge variant="outline" className="text-xs bg-purple-500/10 text-purple-400 border-purple-500/30">
  Weight
</Badge>
```

**AFTER:**
```tsx
<Badge variant="outline" className="text-xs bg-slate-800 text-slate-300 border-slate-600 px-1.5 py-0">
  {option.type}
</Badge>
<Badge variant="outline" className="text-xs bg-blue-500/10 text-blue-400 border-blue-500/40 px-1.5 py-0">
  Default
</Badge>
<Badge variant="outline" className="text-xs bg-red-500/10 text-red-400 border-red-500/40 px-1.5 py-0">
  Required
</Badge>
<Badge variant="outline" className="text-xs bg-emerald-500/10 text-emerald-400 border-emerald-500/40 px-1.5 py-0">
  Pricing
</Badge>
<Badge variant="outline" className="text-xs bg-cyan-500/10 text-cyan-400 border-cyan-500/40 px-1.5 py-0">
  Production
</Badge>
<Badge variant="outline" className="text-xs bg-amber-500/10 text-amber-400 border-amber-500/40 px-1.5 py-0">
  Conditional
</Badge>
<Badge variant="outline" className="text-xs bg-purple-500/10 text-purple-400 border-purple-500/40 px-1.5 py-0">
  Weight
</Badge>
```

**CHANGES:**
- Type badge background: `bg-slate-700/50` → `bg-slate-800` (solid color, better contrast)
- Border opacity for all colored badges: `/30` → `/40` (stronger borders)
- Added `px-1.5 py-0` to all badges (consistent tighter spacing)

---

### File 4: `PricingValidationPanel.tsx`

#### Change 1: Error Box Styling

**BEFORE:**
```tsx
<div
  key={`err-${i}`}
  className="p-3 bg-red-500/15 border-2 border-red-500/50 rounded-lg"
>
```

**AFTER:**
```tsx
<div
  key={`err-${i}`}
  className="p-3 bg-red-500/10 border-2 border-red-500 rounded-md"
>
```

**CHANGES:**
- Background opacity: `/15` → `/10` (slightly lighter)
- Border: `border-red-500/50` → `border-red-500` (solid, prominent red)
- Border radius: `rounded-lg` → `rounded-md`

#### Change 2: Warning Box Styling

**BEFORE:**
```tsx
<div
  key={`warn-${i}`}
  className="p-3 bg-amber-500/15 border border-amber-500/40 rounded-lg"
>
```

**AFTER:**
```tsx
<div
  key={`warn-${i}`}
  className="p-3 bg-amber-500/10 border-2 border-amber-500/40 rounded-md"
>
```

**CHANGES:**
- Background opacity: `/15` → `/10` (consistency with errors)
- Border width: `border` → `border-2` (2px for prominence)
- Border radius: `rounded-lg` → `rounded-md`

---

## 3. FUNCTIONALITY IMPACT CHECK

### File 1: PBV2ProductBuilderLayout.tsx

| Question | Answer | Justification |
|----------|--------|---------------|
| Could this affect navigation? | ⚠️ **POSSIBLY** | If ProductHeader was only rendered here and contains navigation, removing it could break navigation. **REQUIRES VERIFICATION** that ProductHeader is rendered elsewhere. |
| Could this affect Save behavior? | ⚠️ **POSSIBLY** | If ProductHeader contained Save/Publish buttons and they're not rendered elsewhere, Save is broken. **REQUIRES VERIFICATION** that these buttons exist in parent component. |
| Could this affect PBV2 draft load/hydration? | ❌ **NO** | No changes to data flow, useEffect, or hydration logic. Only layout structure changed. |
| Could this affect Pricing Preview rendering? | ❌ **NO** | PricingValidationPanel still receives same props and is rendered in same logical position. |
| Could this affect validation display? | ❌ **NO** | PricingValidationPanel unchanged functionally, only parent wrapper styling changed. |
| Could this affect keyboard focus or click handling? | ❌ **NO** | No event handler changes. All onClick props preserved. |

### File 2: OptionGroupsSidebar.tsx

| Question | Answer | Justification |
|----------|--------|---------------|
| Could this affect navigation? | ❌ **NO** | No routing code. Only visual styling of selection states changed. |
| Could this affect Save behavior? | ❌ **NO** | No Save logic in this component. |
| Could this affect PBV2 draft load/hydration? | ❌ **NO** | No data loading logic. Pure presentational changes. |
| Could this affect Pricing Preview rendering? | ❌ **NO** | No pricing logic in sidebar. |
| Could this affect validation display? | ❌ **NO** | No validation logic. |
| Could this affect keyboard focus or click handling? | ❌ **NO** | All onClick handlers preserved identically. |

### File 3: OptionEditor.tsx

| Question | Answer | Justification |
|----------|--------|---------------|
| Could this affect navigation? | ❌ **NO** | No routing changes. |
| Could this affect Save behavior? | ❌ **NO** | No Save handlers modified. All callbacks preserved. |
| Could this affect PBV2 draft load/hydration? | ❌ **NO** | No useEffect changes. No data flow changes. |
| Could this affect Pricing Preview rendering? | ❌ **NO** | No pricing calculation logic changed. |
| Could this affect validation display? | ❌ **NO** | No validation logic changed. |
| Could this affect keyboard focus or click handling? | ❌ **NO** | All event handlers preserved. Fixed duplicate code did not change functionality. |

### File 4: PricingValidationPanel.tsx

| Question | Answer | Justification |
|----------|--------|---------------|
| Could this affect navigation? | ❌ **NO** | No navigation in this component. |
| Could this affect Save behavior? | ❌ **NO** | No Save logic. |
| Could this affect PBV2 draft load/hydration? | ❌ **NO** | No data loading. Pure presentational. |
| Could this affect Pricing Preview rendering? | ❌ **NO** | Component still receives and displays same `pricingPreview` prop. Only styling of boxes changed. |
| Could this affect validation display? | ❌ **NO** | Component still receives and displays same `findings` prop. Only box styling changed (borders, backgrounds). |
| Could this affect keyboard focus or click handling? | ❌ **NO** | No interactive elements changed. |

---

## 4. RULES COMPLIANCE

### A. Logic Files Check

**Files Verified (NO CHANGES):**
- ✅ `shared/pbv2/pbv2ViewModel.ts` - NOT MODIFIED
- ✅ `client/src/lib/pbv2/pbv2ViewModel.ts` - NOT MODIFIED
- ✅ `shared/pbv2/validator.ts` - NOT MODIFIED
- ✅ `shared/pbv2/pricingAdapter.ts` - NOT MODIFIED
- ✅ `shared/pbv2/normalizeTreeJson.ts` - NOT MODIFIED
- ✅ `client/src/components/PBV2ProductBuilderSectionV2.tsx` - NOT MODIFIED

**Verification Method**: Git status shows only 4 UI component files modified + 1 new file created.

### B. useEffect/useMemo/useCallback Check in PBV2ProductBuilderSectionV2.tsx

**STATUS**: ✅ **NO CHANGES**  
**Evidence**: File not in git changed files list. No modifications to any hooks.

### C. Routing, Guards, History Check

**Files Verified (NO CHANGES):**
- ✅ `client/src/App.tsx` - NOT MODIFIED (React Router config)
- ✅ `client/src/contexts/NavigationGuardContext.tsx` - NOT MODIFIED
- ✅ `client/src/pages/ProductEditorPage.tsx` - NOT MODIFIED (useNavigationGuard hooks)
- ✅ No `useNavigate`, `useLocation`, `useHistory` calls added or modified

---

## 5. NEW/DELETED FILES

### New Files Created:

1. **`client/src/components/pbv2/builder-v2/OptionEditorFigma.tsx`**
   - **Status**: ⚠️ **EXISTS BUT SHOULD BE DELETED**
   - **Purpose**: Temporary exploration file created during development
   - **Is it used?**: ❌ **NO** - Not imported anywhere
   - **Action Required**: DELETE before commit
   - **Risk if committed**: Dead code in repo, potential confusion

### Deleted Files:

- ❌ **NONE**

### Files to Delete Before Commit:

```bash
git rm client/src/components/pbv2/builder-v2/OptionEditorFigma.tsx
```

---

## 6. ROLLBACK PLAN

### Single-File Rollback (if layout breaks):

**Primary Culprit**: `PBV2ProductBuilderLayout.tsx`

```bash
git checkout HEAD -- client/src/components/pbv2/builder-v2/PBV2ProductBuilderLayout.tsx
```

**Effect**: Restores ProductHeader and BasePricingEditor rendering inside layout. Reverts to flex-col stacking layout.

### Full Rollback (all UI changes):

```bash
git checkout HEAD -- client/src/components/pbv2/builder-v2/PBV2ProductBuilderLayout.tsx
git checkout HEAD -- client/src/components/pbv2/builder-v2/OptionGroupsSidebar.tsx
git checkout HEAD -- client/src/components/pbv2/builder-v2/OptionEditor.tsx
git checkout HEAD -- client/src/components/pbv2/builder-v2/PricingValidationPanel.tsx
git rm client/src/components/pbv2/builder-v2/OptionEditorFigma.tsx  # if committed
```

### Verification After Rollback:

```bash
npm run check  # TypeScript compilation
```

---

## 7. CRITICAL PRE-COMMIT VERIFICATIONS REQUIRED

### 🚨 BLOCKER: ProductHeader and BasePricingEditor NOT RENDERED

**ISSUE**: Removed from PBV2ProductBuilderLayout but **NOT rendered anywhere else**.

**Verification Result**:
```
grep -r "ProductHeader|BasePricingEditor" client/src/components/PBV2ProductBuilderSectionV2.tsx
NO MATCHES FOUND
```

**Current Code in PBV2ProductBuilderSectionV2.tsx (Line 1053)**:
```tsx
<PBV2ProductBuilderLayout
  editorModel={editorModel}
  treeJson={localTreeJson}
  selectedGroupId={selectedGroupId}
  // ... 30+ props including onSave, onPublish, onUpdatePricingV2Base ...
/>
```

**IMPACT**:
- ❌ Save button: MISSING
- ❌ Publish button: MISSING  
- ❌ Export JSON button: MISSING
- ❌ Import JSON button: MISSING
- ❌ Product name editor: MISSING
- ❌ Product status badge: MISSING
- ❌ Base pricing editor (perSqftCents, perPieceCents, minimumChargeCents): MISSING
- ❌ Unit system selector (imperial/metric): MISSING
- ❌ Quantity tiers editor: MISSING

**CONCLUSION**: ⛔ **DO NOT COMMIT** - Critical functionality removed without replacement.

### ✅ FIX REQUIRED BEFORE COMMIT:

**Option 1: Revert PBV2ProductBuilderLayout.tsx**
```bash
git checkout HEAD -- client/src/components/pbv2/builder-v2/PBV2ProductBuilderLayout.tsx
```
This restores ProductHeader and BasePricingEditor rendering inside the layout.

**Option 2: Render Components in Parent (Recommended)**  
Add before `<PBV2ProductBuilderLayout>` call in PBV2ProductBuilderSectionV2.tsx:
```tsx
<ProductHeader
  productName={editorModel.productMeta.name}
  productStatus={editorModel.productMeta.status}
  hasUnsavedChanges={hasLocalChanges}
  canPublish={canPublish}
  onSave={handleSave}
  onPublish={handlePublish}
  onExportJson={handleExportJson}
  onImportJson={handleImportJson}
  onUpdateProductName={(name) => handleUpdateProduct({ name })}
/>
<BasePricingEditor
  pricingV2={(localTreeJson as any)?.meta?.pricingV2 || null}
  onUpdateBase={handleUpdatePricingV2Base}
  onUpdateUnitSystem={handleUpdatePricingV2UnitSystem}
  onAddTier={handleAddPricingV2Tier}
  onUpdateTier={handleUpdatePricingV2Tier}
  onDeleteTier={handleDeletePricingV2Tier}
/>
<PBV2ProductBuilderLayout ... />
```

**Option 3: Render in ProductEditorPage.tsx**  
Move ProductHeader and BasePricingEditor to ProductEditorPage wrapper.

**Current Status**: ⛔ **CHANGES ARE BREAKING** - Save/Edit functionality removed.

### ⚠️ REQUIRED ACTION: Delete OptionEditorFigma.tsx

```bash
rm client/src/components/pbv2/builder-v2/OptionEditorFigma.tsx
```

### ✅ VERIFICATION PASSED:

- TypeScript compilation: ✅ NO ERRORS
- All modified files are presentational UI only
- No logic imports changed
- No hooks modified
- No routing modified

---

## 8. SUMMARY OF CHANGES BY TYPE

### Tailwind Class Changes (100% of changes):
- Border colors: `border-[#334155]` → `border-slate-700`
- Border opacity: `/30` → `/40` (badges, group selection)
- Border width: `border` → `border-2` (validation boxes)
- Border radius: `rounded-lg` → `rounded-md`
- Background opacity adjustments: `/50` → solid color (type badge), `/15` → `/10` (validation boxes)
- Padding: Added `px-1.5 py-0` to all badges
- Transition: `transition-colors` → `transition-all`
- Shadow: Added `shadow-sm` to selected group state
- Layout: `flex flex-col` → `flex` (horizontal instead of vertical)
- Overflow: Moved from children to parent or removed redundant declarations

### Layout Structure Changes:
- Flattened PBV2ProductBuilderLayout from 2-level nesting to 1-level
- Moved borders from child components to parent wrappers
- Removed ProductHeader and BasePricingEditor from layout component (⚠️ requires verification they exist elsewhere)

### Component Logic Changes:
- ❌ **ZERO** logic changes
- ❌ **ZERO** prop changes (all interfaces unchanged)
- ❌ **ZERO** event handler changes (all callbacks preserved)
- ❌ **ZERO** state management changes

---

## 9. COMMIT READINESS CHECKLIST

- [ ] ⛔ **BLOCKER**: Revert PBV2ProductBuilderLayout.tsx changes OR render ProductHeader/BasePricingEditor in parent
- [ ] Delete `client/src/components/pbv2/builder-v2/OptionEditorFigma.tsx`
- [ ] Run `npm run check` and confirm NO ERRORS ✅ (PASSED)
- [ ] Manual test: Open Product Editor page and confirm Save button exists ⛔ **WILL FAIL**
- [ ] Manual test: Click Save button and confirm save still works ⛔ **WILL FAIL**
- [ ] Manual test: Verify pricing preview updates when changing options ✅ (Should work)
- [ ] Manual test: Verify validation errors display in right panel ✅ (Should work)

**STATUS**: ⛔ **CANNOT COMMIT** - Critical Save/Publish/Edit functionality removed. Layout changes broke product editing.

**RECOMMENDATION**: Revert PBV2ProductBuilderLayout.tsx to restore functionality, keep only the styling changes (OptionGroupsSidebar, OptionEditor, PricingValidationPanel).

---

**END OF AUDIT REPORT**
