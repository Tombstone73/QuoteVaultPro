# Design Guidelines: Pricing Calculator Web Application

## Design Approach
**System Selected:** Material Design-inspired utility framework
**Rationale:** This is a productivity tool requiring clarity, efficiency, and data-dense displays. Professional B2B interface prioritizing function over aesthetic flourish.

## Typography System
- **Primary Font:** Inter (Google Fonts) - excellent readability for forms and data
- **Headings:** 
  - H1: 32px/2rem, font-weight 700 (Dashboard titles, page headers)
  - H2: 24px/1.5rem, font-weight 600 (Section headers, card titles)
  - H3: 18px/1.125rem, font-weight 600 (Subsections, table headers)
- **Body Text:** 16px/1rem, font-weight 400 (Form labels, descriptions, table content)
- **Small Text:** 14px/0.875rem, font-weight 400 (Helper text, timestamps, metadata)
- **Monospace:** JetBrains Mono for pricing amounts and calculations

## Layout System
**Spacing Units:** Tailwind units of 2, 4, 6, and 8 (e.g., p-4, mt-6, gap-8)
- Consistent card padding: p-6
- Section spacing: mb-8 between major sections
- Form element spacing: gap-4 within forms
- Table cell padding: p-4

**Container Strategy:**
- Login/Signup: max-w-md centered
- Calculator: max-w-4xl with side-by-side layout on desktop
- Quote History: max-w-6xl full-width tables
- Admin Dashboard: max-w-7xl with multi-column metrics

## Component Library

### Navigation
- **Top Navigation Bar:** Fixed header with logo left, user menu/logout right, height h-16
- **Tab Navigation:** Horizontal tabs for "Calculator" | "My Quotes" | "Admin" (if applicable)
- Material-style tab indicator with bottom border

### Calculator Interface
**Layout:** Two-column desktop (product selection left, price display right), stacked mobile
- Product dropdown with rich option display showing name and truncated description
- Dimension inputs: side-by-side width × height with "inches" suffix labels
- Quantity input with numeric stepper controls
- Add-ons as checkbox group with clear labels
- Calculate button: prominent, full-width on mobile, right-aligned desktop
- Price display card: large typography for total, itemized breakdown below in table format
- Product description panel below dropdown with store link as primary button

### Quote History
**Table Design:** Responsive data table with fixed header
- Columns: Date | Customer | Product | Dimensions | Quantity | Price | Actions
- Filter bar above table: search input, date pickers, product filter, price range
- Action buttons per row: View Detail | Email | Copy
- Mobile: Card-based layout stacking table data vertically

### Admin Dashboard
**Overview Cards:** 4-column grid (mobile stacks) showing key metrics
- Total Quotes | Active Users | Top Product | Revenue (example metrics)
- Each card: large number display, small label, subtle icon

**Filters Panel:** Sticky sidebar on desktop, collapsible drawer on mobile
- User selector, date range, product type, quantity range
- Apply/Clear buttons at bottom

**Data Table:** Similar to quote history but with additional "User/Salesperson" column
- Export CSV button in top-right corner
- Pagination controls at bottom

### Admin Settings/Configuration
**Tabbed Interface:** 
- Products | Formulas | Special Rules tabs
- Each tab displays editable data tables with inline editing or modal forms

**Product Management:**
- Table with columns: Product Name | Description | Formula | Store URL | Actions (Edit/Delete)
- Add Product button opens modal form with all fields
- Formula field accepts text input for mathematical expressions

**Forms Throughout:**
- Input fields with floating labels (Material style)
- Clear validation states: border accent on error with helper text below
- Submit buttons disabled until valid, with loading spinner during submission

### Cards & Panels
- Elevated cards with subtle shadow (shadow-md)
- Rounded corners: rounded-lg
- Border style for secondary cards: border with no shadow

### Buttons & Actions
- **Primary Actions:** Solid background, rounded-md, px-6 py-3
- **Secondary Actions:** Outlined style, same sizing
- **Icon Buttons:** Square with rounded-md, p-2
- **Icons:** Heroicons (via CDN) - use outline style for navigation, solid for states

### Data Display
- **Price Typography:** Large, bold monospace in dedicated card with subtle background
- **Tables:** Striped rows, hover state, sticky headers
- **Status Indicators:** Pill-shaped badges (rounded-full, px-3 py-1, text-sm)

## Authentication Pages
- **Login/Signup:** Centered card on clean background
- Logo and title at top
- Form fields stacked with generous spacing (gap-6)
- Primary CTA button full-width
- Toggle link between login/signup at bottom
- No hero image - simple, focused utility design

## Images
**Minimal Image Usage:**
- Logo in navigation header
- Optional: Empty state illustrations for "No quotes yet" in quote history
- Product thumbnails not required but can be added as small icons in dropdowns if available
- This is a utility application, not a marketing site - prioritize data density over imagery

## Responsive Behavior
- **Desktop (lg:):** Multi-column layouts, side-by-side forms, full tables
- **Tablet (md:):** 2-column grids where applicable, full-width forms
- **Mobile:** Single column stacking, hamburger menu for navigation, card-based data display replacing tables

## Key UX Patterns
- Real-time price updates as users input dimensions/quantity
- Toast notifications for success/error states (top-right corner)
- Loading skeletons for data tables during fetch
- Confirmation modals for destructive actions (delete product, etc.)
- Breadcrumb navigation in admin settings for context

This design creates a professional, data-focused interface optimized for efficiency and clarity - appropriate for a B2B pricing tool used by sales teams and administrators.