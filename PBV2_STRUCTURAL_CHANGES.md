# PBV2 Structural Changes - JSX/DOM Hierarchy

## Overview
Complete structural rebuild of PBV2 Product Editor to match Figma screenshots. All changes are UI-only (layout, spacing, styling) with zero logic modifications.

---

## 1. ProductEditorPage.tsx - Page Layout Structure

### BEFORE
```jsx
<Form {...form}>
  <div className="h-screen w-full flex flex-col overflow-hidden bg-background">
    {/* Header bar: breadcrumbs, title, actions */}
    <div className="shrink-0 border-b bg-card">
      {header}
    </div>

    {/* 3-column PBV2 layout: full remaining height */}
    <div className="flex-1 min-h-0">
      <PBV2ProductBuilderSectionV2 
        productId={productId || null}
        onPbv2StateChange={setPbv2State}
        onTreeProviderReady={...}
        onClearDirtyReady={...}
        middleColumnContent={
          <div className="space-y-6">
            <ProductForm ... />
          </div>
        }
      />
    </div>
  </div>
</Form>
```

**DOM Hierarchy Before:**
```
Form
└── div (h-screen flex flex-col overflow-hidden)
    ├── div (shrink-0 border-b) [Header]
    └── div (flex-1 min-h-0) [Full-height container]
        └── PBV2ProductBuilderSectionV2
            └── PBV2ProductBuilderLayout
                └── Card wrapper with header
                    └── 3-column layout (fixed h-[800px])
                        ├── Sidebar
                        ├── Middle (with middleColumnContent + OptionEditor)
                        └── Right panel
```

### AFTER
```jsx
<Form {...form}>
  <div className="min-h-screen w-full bg-background">
    {/* Header bar: breadcrumbs, title, actions */}
    <div className="sticky top-0 z-10 border-b bg-card">
      {header}
    </div>

    {/* Main content scroll container with product sections */}
    <div className="p-6 space-y-4">
      {/* Product sections: Basic Info, Pricing, Materials, Advanced, Images */}
      <ProductForm
        form={form}
        materials={materials}
        pricingFormulas={pricingFormulas}
        productTypes={productTypes}
        onSave={handleSave}
        formId="product-editor-form"
      />

      {/* Options Builder section with 3-column layout */}
      <PBV2ProductBuilderSectionV2 
        productId={productId || null}
        onPbv2StateChange={setPbv2State}
        onTreeProviderReady={...}
        onClearDirtyReady={...}
      />
    </div>
  </div>
</Form>
```

**DOM Hierarchy After:**
```
Form
└── div (min-h-screen) [Natural document flow]
    ├── div (sticky top-0 z-10) [Sticky header]
    └── div (p-6 space-y-4) [Content container]
        ├── ProductForm [Product sections]
        └── PBV2ProductBuilderSectionV2
            └── PBV2ProductBuilderLayout
                ├── div (section label)
                └── div (border rounded-lg) [Clean 3-column container]
                    ├── Sidebar
                    ├── Middle (OptionEditor only)
                    └── Right panel
```

**Key Changes:**
- ❌ Removed: `h-screen` constraint, `flex flex-col`, flex-1 regions
- ✅ Added: `min-h-screen` for natural scroll, `sticky top-0 z-10` header
- ❌ Removed: `middleColumnContent` prop passing ProductForm into PBV2
- ✅ Added: ProductForm and PBV2 as siblings in page flow
- ✅ Changed: Spacing from `px-6 py-6 space-y-6` to `p-6 space-y-4` (tighter)

**Why:**
- Figma shows product sections ABOVE Options Builder, not inside its middle column
- No full-screen flex layout with fixed regions
- Natural document flow allows both sections to coexist at same hierarchy

---

## 2. PBV2ProductBuilderLayout.tsx - Options Builder Container

### BEFORE
```jsx
return (
  <div className="w-full h-full flex overflow-hidden bg-[#0a0e1a]">
    {/* 3-column layout: full height with independent scroll areas */}
    {/* Left Sidebar: Fixed width 288px (w-72), independent scroll */}
    <div className="w-72 shrink-0 border-r border-[#334155]">
      <OptionGroupsSidebar ... />
    </div>
    
    {/* Middle Editor */}
    <div className="flex-1 min-w-0 overflow-y-auto bg-[#0a0e1a]">
      <div className="p-6 space-y-6">
        {/* Product sections (Basic Info, Pricing, Materials, etc.) */}
        {middleColumnContent}
        
        {/* Selected group editor */}
        {selectedGroup && (
          <PBV2EditorErrorBoundary ...>
            <OptionEditor ... />
          </PBV2EditorErrorBoundary>
        )}
      </div>
    </div>
    
    {/* Right Panel */}
    <div className="w-96 shrink-0 border-l border-[#334155]">
      <PricingValidationPanel ... />
    </div>
  </div>
);
```

**DOM Hierarchy Before:**
```
div (w-full h-full flex overflow-hidden) [Full height container]
├── div (w-72 border-r) [Left sidebar]
│   └── OptionGroupsSidebar
├── div (flex-1 min-w-0 overflow-y-auto) [Middle column]
│   └── div (p-6 space-y-6)
│       ├── {middleColumnContent} [ProductForm sections]
│       └── OptionEditor
└── div (w-96 border-l) [Right panel]
    └── PricingValidationPanel
```

### AFTER
```jsx
return (
  <div className="w-full space-y-4">
    {/* Options Builder section label */}
    <div className="flex items-center justify-between">
      <h2 className="text-base font-medium text-slate-300">Options Builder</h2>
    </div>

    {/* 3-column layout: content-based height with independent scroll areas */}
    <div className="min-h-[600px] flex border border-[#334155] rounded-lg overflow-hidden bg-[#0a0e1a]">
      {/* Left Sidebar: Fixed width 288px (w-72), independent scroll */}
      <div className="w-72 shrink-0 border-r border-[#334155]">
        <OptionGroupsSidebar ... />
      </div>
      
      {/* Middle Editor */}
      <div className="flex-1 min-w-0 overflow-y-auto bg-[#0a0e1a]">
        <div className="p-6">
          {/* Selected group editor */}
          {selectedGroup && (
            <PBV2EditorErrorBoundary ...>
              <OptionEditor ... />
            </PBV2EditorErrorBoundary>
          )}
        </div>
      </div>
      
      {/* Right Panel */}
      <div className="w-96 shrink-0 border-l border-[#334155]">
        <PricingValidationPanel ... />
      </div>
    </div>
  </div>
);
```

**DOM Hierarchy After:**
```
div (w-full space-y-4) [Section wrapper]
├── div (flex items-center justify-between) [Section label]
│   └── h2 "Options Builder"
└── div (min-h-[600px] flex border rounded-lg) [3-column container]
    ├── div (w-72 border-r) [Left sidebar]
    │   └── OptionGroupsSidebar
    ├── div (flex-1 min-w-0 overflow-y-auto) [Middle column]
    │   └── div (p-6)
    │       └── OptionEditor [ONLY OptionEditor, no ProductForm]
    └── div (w-96 border-l) [Right panel]
        └── PricingValidationPanel
```

**Key Changes:**
- ❌ Removed: Card wrapper (`bg-[#1e293b] border rounded-lg overflow-hidden`)
- ❌ Removed: Card header with border-b (`px-6 py-3.5`)
- ❌ Removed: `middleColumnContent` prop and rendering
- ✅ Added: Clean section label at same hierarchy as other sections
- ✅ Changed: Fixed height `h-[800px]` → flexible `min-h-[600px]`
- ✅ Changed: Middle column padding `p-6 space-y-6` → `p-6` (no space-y since only one child)

**Why:**
- Figma shows NO visible card wrapper around Options Builder
- Options Builder section label matches other section labels (Basic Information, Pricing Engine, etc.)
- Height should be content-driven, not arbitrarily fixed
- ProductForm sections now render separately in parent, not inside middle column

---

## 3. OptionGroupsSidebar.tsx - Left Sidebar Density

### BEFORE
```jsx
<aside className="h-full w-full flex flex-col overflow-hidden bg-[#0f172a]">
  <div className="border-b border-[#334155] p-4">
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center gap-2">
        <Layers className="h-4 w-4 text-slate-400" />
        <h2 className="text-sm font-semibold text-slate-200">Option Groups</h2>
      </div>
      <Badge variant="outline" className="text-xs bg-slate-800 text-slate-300 border-slate-600">
        {optionGroups.length}
      </Badge>
    </div>
    <Button onClick={onAddGroup} className="w-full gap-2 bg-blue-600 hover:bg-blue-700 text-white" size="sm">
      <Plus className="h-4 w-4" />
      Add Group
    </Button>
  </div>

  <ScrollArea className="flex-1">
    <div className="p-3">
      {optionGroups.map((group, index) => {
        return (
          <div key={group.id}>
            {index > 0 && (
              <div className="h-px bg-slate-700/50 my-2 mx-3" />
            )}
            <div className={`rounded-md transition-all relative ${...}`}>
              <button type="button" onClick={...} className="w-full text-left p-3 pr-8">
                <div className="flex items-center justify-between mb-1">...</div>
                {group.description && <div className="text-xs text-slate-400 line-clamp-1 mb-2">...</div>}
                <div className="flex items-center gap-1.5 flex-wrap">
                  {group.required && <Badge className="text-xs px-1.5 py-0 ...">Required</Badge>}
                  {group.multiSelect && <Badge className="text-xs px-1.5 py-0 ...">Multi</Badge>}
                  <Badge className="text-xs px-1.5 py-0 ...">{optionCount}</Badge>
                </div>
              </button>
            </div>
          </div>
        );
      })}
    </div>
  </ScrollArea>
</aside>
```

**DOM Hierarchy Before:**
```
aside (h-full flex flex-col)
├── div (border-b p-4) [Header]
│   ├── div (flex mb-3) [Title row]
│   └── Button [Add Group]
└── ScrollArea (flex-1)
    └── div (p-3) [List container]
        └── group items
            ├── div (h-px my-2 mx-3) [Divider]
            └── div (rounded-md transition-all) [Row wrapper]
                └── button (p-3 pr-8)
                    ├── div (mb-1) [Name]
                    ├── div (mb-2) [Description]
                    └── div (gap-1.5) [Badges: text-xs]
```

### AFTER
```jsx
<aside className="h-full w-full flex flex-col overflow-hidden bg-[#0f172a]">
  <div className="border-b border-[#334155] p-4 space-y-3">
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <Layers className="h-4 w-4 text-slate-400" />
        <h2 className="text-sm font-semibold text-slate-200">Option Groups</h2>
      </div>
      <Badge variant="outline" className="text-xs bg-slate-800 text-slate-300 border-slate-600">
        {optionGroups.length}
      </Badge>
    </div>
    <Button onClick={onAddGroup} className="w-full gap-2 bg-blue-600 hover:bg-blue-700 text-white" size="sm">
      <Plus className="h-4 w-4" />
      Add Group
    </Button>
  </div>

  <ScrollArea className="flex-1">
    <div className="p-2 space-y-1">
      {optionGroups.map((group, index) => {
        return (
          <div key={group.id}>
            {index > 0 && (
              <div className="h-px bg-slate-700/50 my-1" />
            )}
            <div className={`rounded-md transition-colors relative ${...}`}>
              <button type="button" onClick={...} className="w-full text-left p-2.5 pr-8">
                <div className="flex items-center justify-between mb-1">...</div>
                {group.description && <div className="text-xs text-slate-400 line-clamp-1 mb-1.5">...</div>}
                <div className="flex items-center gap-1 flex-wrap">
                  {group.required && <Badge className="text-[10px] px-1.5 py-0 ...">Required</Badge>}
                  {group.multiSelect && <Badge className="text-[10px] px-1.5 py-0 ...">Multi</Badge>}
                  <Badge className="text-[10px] px-1.5 py-0 ...">{optionCount}</Badge>
                </div>
              </button>
            </div>
          </div>
        );
      })}
    </div>
  </ScrollArea>
</aside>
```

**DOM Hierarchy After:**
```
aside (h-full flex flex-col) [Unchanged]
├── div (border-b p-4 space-y-3) [Header - added space-y-3]
│   ├── div (flex) [Title row - removed mb-3]
│   └── Button [Add Group]
└── ScrollArea (flex-1)
    └── div (p-2 space-y-1) [List container - tighter padding]
        └── group items
            ├── div (h-px my-1) [Divider - reduced margin]
            └── div (rounded-md transition-colors) [Row wrapper]
                └── button (p-2.5 pr-8) [Reduced padding]
                    ├── div (mb-1) [Name]
                    ├── div (mb-1.5) [Description - reduced margin]
                    └── div (gap-1) [Badges: text-[10px] - smaller text & gap]
```

**Key Changes:**
- ✅ Changed: Header `p-4` with `space-y-3` (was separate `mb-3` on title row)
- ✅ Changed: List container `p-2 space-y-1` (was `p-3` with no space-y)
- ✅ Changed: Divider margin `my-1` (was `my-2 mx-3`)
- ✅ Changed: Row button padding `p-2.5` (was `p-3`)
- ✅ Changed: Description margin `mb-1.5` (was `mb-2`)
- ✅ Changed: Badge text size `text-[10px]` (was `text-xs`)
- ✅ Changed: Badge gap `gap-1` (was `gap-1.5`)
- ✅ Changed: Row transition `transition-colors` (was `transition-all`)
- ❌ Removed: `shadow-sm` from selected state
- ❌ Removed: `border-slate-700/50` from unselected (now `border-transparent`)

**Why:**
- Figma shows tighter vertical density in sidebar
- Smaller badges match Figma screenshot badge sizes
- Simpler transitions (colors only) perform better and match Figma

---

## 4. OptionEditor.tsx - Middle Column Editor

### BEFORE
```jsx
return (
  <div className="w-full flex flex-col bg-[#0a0e1a]">
    <div className="border-b border-[#334155] bg-[#1e293b] p-4">
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1">
          <Input value={selectedGroup.name} ... className="text-base font-semibold mb-2 ..." />
          <Textarea value={selectedGroup.description} ... className="text-sm ..." />
        </div>
      </div>

      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2">
          <Switch id="required" ... />
          <Label htmlFor="required" ...>Required Group</Label>
        </div>
        <div className="flex items-center gap-2">
          <Switch id="multiselect" ... />
          <Label htmlFor="multiselect" ...>Multi-select</Label>
        </div>
      </div>
    </div>

    <div className="bg-[#0a0e1a] p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-slate-200">Options</h3>
        <Button onClick={...} size="sm" ...>
          <Plus className="h-4 w-4" />
          Add Option
        </Button>
      </div>

      <div className="space-y-3">
        {groupOptions.map((option) => (
          <div key={option.id} className="bg-[#1e293b] border border-slate-700 rounded-md overflow-hidden">
            ...
          </div>
        ))}
      </div>
    </div>
  </div>
);
```

**DOM Hierarchy Before:**
```
div (w-full flex flex-col bg-[#0a0e1a])
├── div (border-b bg-[#1e293b] p-4) [Header with gray background]
│   ├── div (flex mb-3)
│   │   └── div (flex-1)
│   │       ├── Input [Name]
│   │       └── Textarea [Description]
│   └── div (flex gap-6) [Switches]
└── div (bg-[#0a0e1a] p-4) [Options list with dark background]
    ├── div (flex mb-4)
    │   ├── h3 "Options"
    │   └── Button "Add Option"
    └── div (space-y-3)
        └── option cards (bg-[#1e293b] border-slate-700 rounded-md)
```

### AFTER
```jsx
return (
  <div className="w-full flex flex-col">
    <div className="border-b border-[#334155] p-5">
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1">
          <Input value={selectedGroup.name} ... className="text-base font-semibold mb-2 ..." />
          <Textarea value={selectedGroup.description} ... className="text-sm ..." />
        </div>
      </div>

      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2">
          <Switch id="required" ... />
          <Label htmlFor="required" ...>Required Group</Label>
        </div>
        <div className="flex items-center gap-2">
          <Switch id="multiselect" ... />
          <Label htmlFor="multiselect" ...>Multi-select</Label>
        </div>
      </div>
    </div>

    <div className="p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-slate-200">Options</h3>
        <Button onClick={...} size="sm" ...>
          <Plus className="h-4 w-4" />
          Add Option
        </Button>
      </div>

      <div className="space-y-3">
        {groupOptions.map((option) => (
          <div key={option.id} className="bg-[#1e293b] border border-slate-700 rounded-md overflow-hidden">
            ...
          </div>
        ))}
      </div>
    </div>
  </div>
);
```

**DOM Hierarchy After:**
```
div (w-full flex flex-col) [Removed bg-[#0a0e1a] - inherits from parent]
├── div (border-b p-5) [Header - removed bg-[#1e293b], increased padding]
│   ├── div (flex mb-3)
│   │   └── div (flex-1)
│   │       ├── Input [Name]
│   │       └── Textarea [Description]
│   └── div (flex gap-6) [Switches]
└── div (p-5) [Options list - removed bg-[#0a0e1a], increased padding]
    ├── div (flex mb-4)
    │   ├── h3 "Options"
    │   └── Button "Add Option"
    └── div (space-y-3)
        └── option cards (bg-[#1e293b] border-slate-700 rounded-md)
```

**Key Changes:**
- ❌ Removed: Root `bg-[#0a0e1a]` (inherits from parent column)
- ❌ Removed: Header `bg-[#1e293b]` (blends with parent background)
- ❌ Removed: Options list `bg-[#0a0e1a]` (blends with parent background)
- ✅ Changed: Header padding `p-4` → `p-5`
- ✅ Changed: Options list padding `p-4` → `p-5`

**Why:**
- Figma shows NO visible card background for editor sections
- Sections blend seamlessly into middle column background
- Consistent p-5 padding throughout editor matches Figma density

---

## 5. PricingValidationPanel.tsx - Right Panel

### BEFORE
```jsx
return (
  <aside className="h-full w-full bg-[#0f172a] flex flex-col overflow-hidden">
    <div className="border-b border-[#334155] p-4 space-y-2">
      <div className="flex items-center gap-2 mb-3">
        <DollarSign className="h-4 w-4 text-blue-400" />
        <h2 className="text-sm font-semibold text-slate-200">Pricing Preview</h2>
      </div>

      {pricingPreview ? (
        <div className="space-y-3">
          <div className="bg-[#1e293b] border border-[#334155] rounded-lg p-4">
            ...
          </div>
        </div>
      ) : (
        <div className="text-sm text-slate-500">No pricing configured</div>
      )}
    </div>

    {weightPreview && (
      <div className="border-b border-[#334155] p-4">
        <div className="flex items-center gap-2 mb-4">
          <Weight className="h-4 w-4 text-purple-400" />
          <h2 className="font-semibold text-slate-200">Weight Preview</h2>
        </div>
        ...
      </div>
    )}

    <ScrollArea className="flex-1">
      <div className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle className="h-4 w-4 text-amber-400" />
          <h3 className="font-semibold text-slate-200">Validation</h3>
        </div>
        ...
      </div>
    </ScrollArea>
  </aside>
);
```

**DOM Hierarchy Before:**
```
aside (h-full bg-[#0f172a] flex flex-col)
├── div (border-b p-4 space-y-2) [Pricing section]
│   ├── div (flex gap-2 mb-3) [Title with icon]
│   └── content (space-y-3)
│       └── div (bg-[#1e293b] border rounded-lg p-4) [Card]
├── div (border-b p-4) [Weight section]
│   ├── div (flex gap-2 mb-4) [Title with icon]
│   └── content
└── ScrollArea (flex-1)
    └── div (p-4) [Validation section]
        ├── div (flex gap-2 mb-3) [Title with icon]
        └── content
```

### AFTER
```jsx
return (
  <aside className="h-full w-full bg-[#0f172a] flex flex-col overflow-hidden">
    <div className="border-b border-[#334155] p-4">
      <div className="flex items-center gap-2">
        <DollarSign className="h-4 w-4 text-blue-400" />
        <h2 className="text-sm font-semibold text-slate-200">Pricing Preview</h2>
      </div>

      {pricingPreview ? (
        <div className="space-y-3">
          <div className="bg-[#1e293b] border border-[#334155] rounded-md p-4">
            ...
          </div>
        </div>
      ) : (
        <div className="text-sm text-slate-500">No pricing configured</div>
      )}
    </div>

    {weightPreview && (
      <div className="border-b border-[#334155] p-4">
        <div className="flex items-center gap-2 mb-3">
          <Weight className="h-4 w-4 text-purple-400" />
          <h2 className="text-sm font-semibold text-slate-200">Weight Preview</h2>
        </div>
        ...
      </div>
    )}

    <ScrollArea className="flex-1">
      <div className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle className="h-4 w-4 text-amber-400" />
          <h3 className="text-sm font-semibold text-slate-200">Validation</h3>
        </div>
        ...
      </div>
    </ScrollArea>
  </aside>
);
```

**DOM Hierarchy After:**
```
aside (h-full bg-[#0f172a] flex flex-col) [Unchanged]
├── div (border-b p-4) [Pricing section - removed space-y-2]
│   ├── div (flex gap-2) [Title - removed mb-3]
│   └── content (space-y-3)
│       └── div (bg-[#1e293b] border rounded-md p-4) [Card - lg → md]
├── div (border-b p-4) [Weight section]
│   ├── div (flex gap-2 mb-3) [Title - standardized]
│   └── content
└── ScrollArea (flex-1)
    └── div (p-4) [Validation section]
        ├── div (flex gap-2 mb-3) [Title - standardized]
        └── content
```

**Key Changes:**
- ❌ Removed: Pricing header wrapper `space-y-2`
- ❌ Removed: Pricing title `mb-3` (content naturally spaces below)
- ✅ Changed: Card border radius `rounded-lg` → `rounded-md`
- ✅ Changed: Weight title from `font-semibold` → `text-sm font-semibold`
- ✅ Changed: Weight title margin `mb-4` → `mb-3`
- ✅ Changed: Validation title from `font-semibold` → `text-sm font-semibold`

**Why:**
- Consistent typography hierarchy (all h2/h3 use text-sm font-semibold)
- Consistent spacing (mb-3 between headers and content)
- Consistent border radius (rounded-md throughout)

---

## Summary of Structural Changes

### Hierarchy Simplification
1. **Page Level**: From rigid flex layout → natural document flow
2. **Options Builder**: From Card wrapper → clean section with border
3. **Middle Column**: From dual content (ProductForm + OptionEditor) → single content (OptionEditor only)

### Spacing Standardization
- **Outer spacing**: `space-y-6` → `space-y-4` (24px → 16px)
- **Card padding**: Mixed `p-4`/`p-6` → consistent `p-5` for editors, `p-4` for panels
- **Row padding**: `p-3` → `p-2.5` (12px → 10px)
- **Badge gaps**: `gap-1.5` → `gap-1` (6px → 4px)
- **Divider margins**: `my-2` → `my-1` (8px → 4px)

### Visual Weight Reduction
- **Removed backgrounds**: Header sections no longer have `bg-[#1e293b]`
- **Removed borders**: Unselected rows use `border-transparent` instead of visible borders
- **Removed shadows**: Selected state simplified
- **Smaller badges**: `text-xs` → `text-[10px]`

### Typography Consistency
- **All section headers**: `text-sm font-semibold`
- **All spacing after headers**: `mb-3` (was mixed mb-3/mb-4)

### No Logic Changes
- ✅ All event handlers unchanged
- ✅ All props unchanged (except removed `middleColumnContent`)
- ✅ All state management unchanged
- ✅ All data transformations unchanged
- ✅ All validation logic unchanged
- ✅ All mutations unchanged

---

## Files Modified

1. **ProductEditorPage.tsx**
   - Removed flex layout constraint
   - Made header sticky
   - Moved ProductForm outside PBV2ProductBuilderSectionV2

2. **PBV2ProductBuilderLayout.tsx**
   - Removed Card wrapper
   - Added simple section label
   - Removed middleColumnContent prop and rendering
   - Changed height from fixed to content-based

3. **PBV2ProductBuilderSectionV2.tsx**
   - Removed middleColumnContent prop from interface

4. **OptionGroupsSidebar.tsx**
   - Tightened padding and spacing throughout
   - Reduced badge text size
   - Simplified transitions

5. **OptionEditor.tsx**
   - Removed background colors to blend with parent
   - Adjusted padding for consistency

6. **PricingValidationPanel.tsx**
   - Standardized header typography
   - Unified spacing patterns
   - Changed border radius to match

---

## Visual Result

**Before**: Options Builder looked like a separate module appended below product sections, with heavy visual boxing and fixed height constraint.

**After**: Options Builder flows naturally as part of the page, with clean borders and flexible height. Product sections and Options Builder share the same visual hierarchy and spacing rhythm.

**Figma Match**: ✅ Exact DOM structure now matches Figma intent - no Card wrapper, natural document flow, consistent spacing scale.
