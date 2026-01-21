# Lamination Display Visual Reference

## Job Specifications Card - Roll Jobs

```
┌─────────────────────────────────────────────┐
│  Job Specifications                         │
├─────────────────────────────────────────────┤
│  Customer:       ACME Printing              │
│  Order #:        ORD-1001 (link)            │
│  Job ID:         748d5a29cf48                │
│  Due Date:       Jan 15, 2025               │
│  Priority:       normal                     │
│  Description:    Roll Banner Print          │
│  Media:          13oz Scrim Vinyl           │
│  Size:           54" wide × 120" run        │
│  Quantity:       1                          │
│  Sides:          Single                     │
│                                             │
│  Lamination:     [ GLOSS ]  ← BLUE BADGE    │  ← NEW
│                  (from notes)               │  ← SOURCE
│                                             │
│  Station:        roll                       │
│  Step:           printing                   │
└─────────────────────────────────────────────┘
```

## Badge Color Examples

### 1. Gloss Lamination
```
Lamination:  [ GLOSS ]  ← bg-blue-500
```

### 2. Matte Lamination
```
Lamination:  [ MATTE ]  ← bg-slate-500
```

### 3. Textured Floor (Anti-slip)
```
Lamination:  [ TEXTURED FLOOR (ANTI-SLIP) ]  ← bg-amber-500
```

### 4. Custom Lamination
```
Lamination:  [ CUSTOM (SEE NOTES) ]  ← bg-purple-500
```

### 5. No Lamination Data
```
Lamination:  [ — ]  ← outline variant (gray)
```

## Source Indicators

### From Structured Option
```
Lamination:  [ GLOSS ]
             ↑ No indicator - most reliable source
```

### From Notes Text Search
```
Lamination:  [ MATTE ]  (from notes)
             ↑ Shows source indicator - less reliable
```

## Context: Where It Appears

**Production Job Detail Page**: `/production/jobs/:jobId`

- **LEFT COLUMN**: Actions, Timer, Timeline
- **RIGHT COLUMN**:
  1. Artwork Thumbnails (top)
  2. **Job Specifications** ← Lamination appears here
  3. Order Jobs (other jobs in same order)
  4. Add Note

## Roll vs Flatbed Behavior

### Roll Job (stationKey = "roll")
```
✅ Lamination field SHOWN
   - Always displayed (even if "—")
   - Color-coded badge
   - Source indicator when from notes
```

### Flatbed Job (stationKey = "flatbed")
```
❌ Lamination field HIDDEN
   - Not relevant for flatbed printing
   - Field completely omitted
```

## UI States

### State 1: Loading
```
Lamination:  [Loading...]
```

### State 2: Loaded with Data
```
Lamination:  [ GLOSS ]
```

### State 3: Loaded without Data
```
Lamination:  [ — ]
```

### State 4: Error (Fallback)
```
Lamination:  [ — ]
(Same as "no data" - graceful degradation)
```

## Mobile/Responsive Behavior

The badge wraps naturally:
```
Desktop (wide):
Lamination:  [ TEXTURED FLOOR (ANTI-SLIP) ]  (from notes)

Mobile (narrow):
Lamination:
[ TEXTURED FLOOR (ANTI-SLIP) ]
(from notes)
```

## Operator Workflow

1. Operator opens Roll job from Production Board
2. Views Job Specifications card
3. **Sees lamination prominently** between "Sides" and "Station"
4. If "Custom", knows to check Notes section for details
5. If "(from notes)" indicator, knows data is inferred (not from structured option)
6. If "—", knows no lamination specified (valid state)

## Design Decisions

### Why Always Show Field (Never Hide)?
- **Operator Clarity**: Showing "—" confirms "no lamination" rather than leaving ambiguity
- **Consistency**: Field position remains stable across all Roll jobs
- **Validation**: Operators can verify if lamination data is missing

### Why Color-Coded?
- **Quick Identification**: Operators can spot lamination type at a glance
- **Visual Hierarchy**: Important finishing step gets visual weight
- **Error Prevention**: Distinct colors reduce chance of misreading

### Why Between "Sides" and "Station"?
- **Logical Flow**: Follows print-related specs (media → size → sides → **lamination** → routing)
- **Visibility**: Middle of card, not buried at bottom
- **Roll-Specific**: Close to other Roll-specific info

## Testing Scenarios

### Scenario 1: Structured Lamination Option
```
Input:
  selectedOptions: [
    { optionName: "Lamination Type", value: "gloss" }
  ]

Output:
  Lamination:  [ GLOSS ]
```

### Scenario 2: Notes-Based Detection
```
Input:
  selectedOptions: []
  notes: "Customer wants matte lamination on this banner"

Output:
  Lamination:  [ MATTE ]  (from notes)
```

### Scenario 3: Custom Lamination
```
Input:
  selectedOptions: [
    { optionName: "Lamination", value: "custom", note: "Special UV-resistant coating" }
  ]

Output:
  Lamination:  [ CUSTOM (SEE NOTES) ]
```

### Scenario 4: No Lamination
```
Input:
  selectedOptions: []
  notes: "No special finish required"

Output:
  Lamination:  [ — ]
```

## Browser Compatibility

- Chrome/Edge: ✅ Full support
- Firefox: ✅ Full support  
- Safari: ✅ Full support
- Mobile browsers: ✅ Responsive badges

## Accessibility

- Badges use semantic color + text (not color-only)
- Screen readers announce: "Lamination: Gloss"
- Keyboard navigation: Standard tab order
