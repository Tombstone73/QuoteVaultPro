# TITAN KERNEL Module Completion Document — Product Catalog & Product Options

## Module Purpose
The Product Catalog & Options module provides a flexible, hierarchical product configuration system that enables dynamic quote building. It solves the business problem of:
- **Product Organization**: Structured catalog with types, products, variants, and options for easy navigation
- **Dynamic Configuration**: Real-time price updates as customers select options and enter specifications
- **Visual Product Selection**: Gallery and list views with thumbnail support for intuitive browsing
- **Hierarchical Options**: Parent-child dependencies allow complex product configurations (e.g., grommets → grommet spacing)
- **Bulk Management**: CSV import/export for efficient catalog maintenance
- **Variant Pricing**: Multiple material/finish options per product with individual pricing
- **Reusability**: Products can be cloned with all configurations for rapid catalog expansion

## Data Model Summary

### Tables
- **`productTypes`**: Top-level taxonomy
  - `id`, `name`, `description`
  - `sortOrder` (integer): Display ordering
  - Timestamps: `createdAt`, `updatedAt`

- **`products`**: Core product catalog (see Pricing Formula Engine doc for full schema)
  - `id`, `name`, `description`, `productTypeId`
  - `category` (varchar): Sub-categorization
  - `thumbnailUrls` (text[]): Product images
  - `storeUrl` (varchar): Link to external product page
  - `showStoreLink` (boolean): Toggle link visibility
  - `variantLabel` (varchar): Custom label for variants (e.g., "Material", "Media Type")
  - `isActive` (boolean): Visibility toggle
  - Pricing fields: `pricingFormula`, `useNestingCalculator`, etc.
  - Timestamps: `createdAt`, `updatedAt`

- **`productVariants`**: Material/finish options
  - `id`, `productId`, `name`, `description`
  - `basePricePerSqft` (decimal): Pricing basis
  - `volumePricing` (jsonb): Tiered discount rules
  - `isDefault` (boolean): Auto-select on product selection
  - `displayOrder` (integer): Sort order in dropdown
  - `isActive` (boolean): Visibility toggle
  - Timestamps: `createdAt`, `updatedAt`

- **`productOptions`**: Configurable add-ons
  - `id`, `productId`, `name`, `description`
  - `type` (varchar): "toggle" | "number" | "select"
  - `defaultValue` (text): For number/select types (comma-separated for select)
  - `defaultSelection` (text): Default select choice
  - `isDefaultEnabled` (boolean): Default state for toggles
  - `setupCost` (decimal): Base cost component
  - `priceFormula` (text): Dynamic pricing calculation
  - `parentOptionId` (varchar, nullable FK): Enables hierarchical dependencies
  - `displayOrder` (integer): Sort order
  - `isActive` (boolean): Visibility toggle
  - Timestamps: `createdAt`, `updatedAt`

### Relationships
- `products.productTypeId -> productTypes.id` (RESTRICT delete)
- `productVariants.productId -> products.id` (CASCADE delete)
- `productOptions.productId -> products.id` (CASCADE delete)
- `productOptions.parentOptionId -> productOptions.id` (CASCADE delete, self-referencing)

### Enums
- **Product Option Type**: "toggle", "number", "select"
- **Material Type**: "sheet", "roll"

### Key Constraints
- Product names must be unique within the system
- At least one variant should be marked as default per product
- Option display orders should be unique within a product
- Parent option must be a "toggle" type for parent-child relationships
- Product must have either `pricingFormula` OR `useNestingCalculator` enabled

## Backend Summary

### Migrations
- **`0000_cool_taskmaster.sql`**: Initial tables for productTypes, products, productVariants, productOptions
- Schema changes integrated into pricing formula migrations (see Pricing Formula Engine doc)

### Schema (`shared/schema.ts`)
- **`insertProductTypeSchema`**: name (required), description, sortOrder (default 0)
- **`insertProductSchema`**: name, description required; optional productTypeId, category, thumbnailUrls array, storeUrl, showStoreLink, variantLabel
- **`insertProductVariantSchema`**: productId, name, basePricePerSqft (positive) required; optional volumePricing, isDefault, displayOrder
- **`insertProductOptionSchema`**: productId, name, type (enum) required; optional description, defaultValue, setupCost (non-negative), priceFormula, parentOptionId, displayOrder
- All schemas use Zod for runtime validation with `createInsertSchema` helper

### Storage Methods (`server/storage.ts`)

**Product Types**:
- `getAllProductTypes()`: Returns all types sorted by sortOrder
- `createProductType(data)`: Insert new type
- `updateProductType(id, data)`: Update existing type
- `deleteProductType(id)`: Delete type (fails if products reference it)

**Products**:
- `getAllProducts()`: Returns all products with type relations
- `getProductById(id)`: Single product detail
- `createProduct(data)`: Create with auto-generation of UUID
- `updateProduct(id, data)`: Partial updates supported
- `deleteProduct(id)`: CASCADE deletes variants and options
- `cloneProduct(id)`: Duplicates product with all variants and options (new UUIDs)

**Product Variants**:
- `getProductVariants(productId)`: List all variants for a product
- `createProductVariant(data)`: Add variant to product
- `updateProductVariant(id, data)`: Update variant details
- `deleteProductVariant(id)`: Remove variant

**Product Options**:
- `getProductOptions(productId)`: List all options for a product (includes parent-child structure)
- `createProductOption(data)`: Add option to product
- `updateProductOption(id, data)`: Update option configuration
- `deleteProductOption(id)`: Remove option (CASCADE removes children)

### Business Rules

1. **Product Type Assignment**:
   - Products can optionally be assigned to a type for organization
   - Types cannot be deleted if products reference them (RESTRICT constraint)
   - Types with sortOrder are displayed in ascending order

2. **Product Activation**:
   - Inactive products (`isActive=false`) are hidden from customer-facing calculator
   - Admin users can still view and edit inactive products
   - Deactivation is reversible (soft delete pattern)

3. **Variant Selection**:
   - When product is selected, system auto-selects the variant marked `isDefault=true`
   - If no default exists, user must manually select variant
   - Only one variant should be marked as default per product (not enforced at DB level)
   - Inactive variants are filtered from selection dropdowns

4. **Option Dependencies**:
   - Parent option MUST be of type "toggle"
   - Child options only appear when parent toggle is enabled
   - Deletion of parent option CASCADE deletes all children
   - Child option values are not evaluated if parent is disabled

5. **Option Type Behaviors**:
   - **Toggle**: Boolean on/off state; if off, option cost is $0
   - **Number**: User inputs numeric value; formula can reference as `value`
   - **Select**: User chooses from comma-separated options in `defaultValue`; formula uses `eqstr(value, "choice")` pattern

6. **Thumbnail Management**:
   - Stored as array of public URLs (GCS/object storage)
   - First thumbnail displayed in gallery view
   - Empty array shows default placeholder icon
   - Multiple images supported for product galleries

7. **Store Link Behavior**:
   - If `storeUrl` is set and `showStoreLink=true`, displays "View in Store" button
   - Link opens in new tab (target="_blank")
   - Useful for products sold in external marketplaces

8. **CSV Import Rules**:
   - Rows must have Type column: "PRODUCT", "VARIANT", or "OPTION"
   - Products must be imported before their variants/options
   - Parent options must be imported before child options
   - Duplicate product names append incrementing suffix
   - Empty optional fields treated as NULL

## API Summary

### Routes (`server/routes.ts`)

#### Product Types
- **GET `/api/product-types`** (authenticated): List all types sorted by sortOrder
- **POST `/api/product-types`** (admin): Create new type
  - Body: `{ name, description?, sortOrder? }`
- **PATCH `/api/product-types/:id`** (admin): Update type
- **DELETE `/api/product-types/:id`** (admin): Delete type (fails if in use)

#### Products
- **GET `/api/products`** (authenticated): List all active products
  - Returns: Products array with productType relation
- **GET `/api/products/:id`** (authenticated): Get single product detail
- **POST `/api/products`** (admin): Create product
  - Body: `{ name, description, productTypeId?, category?, thumbnailUrls?, storeUrl?, showStoreLink?, variantLabel?, pricingFormula?, useNestingCalculator?, ... }`
- **PATCH `/api/products/:id`** (admin): Update product (partial)
- **PUT `/api/products/:id/thumbnails`** (admin): Update product images
  - Body: `{ thumbnailUrls: string[] }`
  - Automatically sets ACL to public for each URL
- **DELETE `/api/products/:id`** (admin): Delete product and CASCADE dependencies
- **POST `/api/products/:id/clone`** (admin): Duplicate product
  - Creates new product with "(Copy)" suffix
  - Clones all variants and options with new UUIDs

#### Product Variants
- **GET `/api/products/:id/variants`** (authenticated): List variants for product
- **POST `/api/products/:id/variants`** (admin): Create variant
  - Body: `{ name, description?, basePricePerSqft, volumePricing?, isDefault?, displayOrder? }`
- **PATCH `/api/products/:productId/variants/:id`** (admin): Update variant
- **DELETE `/api/products/:productId/variants/:id`** (admin): Delete variant

#### Product Options
- **GET `/api/products/:id/options`** (authenticated): List options with parent-child structure
- **POST `/api/products/:id/options`** (admin): Create option
  - Body: `{ name, description?, type, defaultValue?, defaultSelection?, isDefaultEnabled?, setupCost?, priceFormula?, parentOptionId?, displayOrder? }`
- **PATCH `/api/products/:productId/options/:id`** (admin): Update option
- **DELETE `/api/products/:productId/options/:id`** (admin): Delete option (CASCADE to children)

#### CSV Operations
- **GET `/api/products/csv-template`** (admin): Download template file
  - Returns: CSV with example rows for PRODUCT, VARIANT, OPTION types
  - Includes all required/optional columns with sample data
- **POST `/api/products/import`** (admin): Bulk import from CSV
  - Body: `{ csvData: string }`
  - Process: Parse CSV → Validate rows → Create products/variants/options in sequence
  - Returns: `{ imported: { products: number, variants: number, options: number } }`
- **GET `/api/products/export`** (admin): Export all products to CSV
  - Returns: CSV file with all products, variants, and options
  - Filename: `products-export-{timestamp}.csv`

### Validation
- All endpoints use Zod schemas for input validation
- Invalid data returns 400 with detailed error message from `fromZodError`
- Foreign key violations return 404 for "not found" or 400 for "in use"
- Number fields automatically coerced from strings (e.g., "5.50" → 5.50)

### Response Formats
- Success: `{ ...data }` or `{ success: true, data: {...} }`
- Error: `{ message: "Error description" }`
- Lists: Array of objects with full relations included

## Frontend Summary

### Pages
None dedicated to product catalog (integrated into calculator and admin interfaces)

### Components

**`client/src/components/calculator.tsx`** (Primary UI):
- **Product View Toggle**: Switch between dropdown and gallery modes
  - Dropdown: Standard select element with product names
  - Gallery: Grid of cards with thumbnails, names, categories
- **Product Card** (Gallery mode):
  - Thumbnail image or placeholder icon
  - Product name and category
  - "Selected" badge when active
  - Hover elevation effect
  - Click to select
- **Product Selector** (Dropdown mode):
  - Filterable select with all active products
  - Sorted by name or type
  - Shows product name only
- **Variant Selector**:
  - Dropdown with variant name and base price per sqft
  - Auto-selects default variant when product chosen
  - Label customized by product's `variantLabel` field
- **Options Renderer**:
  - **Toggle Options**: Switch component with label/description
  - **Number Options**: Number input with step validation
  - **Select Options**: Dropdown with choices from `defaultValue`
  - **Parent-Child Options**: Children nested with indentation, only visible when parent enabled
  - Sorted by `displayOrder` within parent groups
- **Store Link**: External link button (if `showStoreLink=true`)
- **Field Validation**: Red borders on required empty fields
- **Error Display**: Toast notifications for validation errors

**Product Management UI** (Admin interfaces):
- Product CRUD forms with all fields
- Variant management table with inline editing
- Option builder with parent selection dropdown
- Thumbnail uploader with multi-file support
- Formula editor with syntax highlighting (if available)

### Hooks
- **`useProductTypes`** (custom or via useQuery): Fetch product types
- **Calculator queries** (via React Query):
  - `/api/products`: Main product catalog
  - `/api/products/:id/variants`: Variant list
  - `/api/products/:id/options`: Option list with dependencies
- **Mutations**:
  - Product/variant/option CRUD operations
  - CSV import trigger

### State Management
- **Selected Product ID**: String UUID or empty
- **Selected Variant ID**: String UUID or null
- **Product View Mode**: "dropdown" | "gallery"
- **Option Values**: `Record<optionId, value>` where value is boolean | number | string
- **Field Errors**: `Record<fieldName, boolean>` for validation highlighting
- **Calculated Price**: Number or null

### Key Interactions

1. **Select Product (Gallery)**:
   - Click product card
   - Card highlights with "Selected" badge
   - Variant dropdown populates and auto-selects default
   - Options render below
   - Store link appears if configured

2. **Select Product (Dropdown)**:
   - Open select dropdown
   - Type to filter products
   - Click selection
   - Same cascade as gallery mode

3. **Configure Variant**:
   - Dropdown shows: "{Variant Name} (${price}/sqft)"
   - Select different variant
   - Auto-recalculates price in real-time

4. **Toggle Option**:
   - Click switch to enable/disable
   - If parent option: Child options appear/disappear
   - Price updates immediately

5. **Adjust Number Option**:
   - Input numeric value
   - Validation ensures positive finite number
   - Price recalculates on change

6. **Select Option Choice**:
   - Open dropdown with predefined choices
   - Select option
   - Formula evaluates based on selection
   - Price updates

7. **View Store Link**:
   - Click "View in Store" button
   - Opens external URL in new tab
   - User can reference detailed product info

8. **Admin: Clone Product**:
   - Click "Clone" button on product row
   - System duplicates product with "(Copy)" suffix
   - All variants and options cloned with new IDs
   - Navigate to edit cloned product

9. **Admin: CSV Import**:
   - Download template file
   - Fill in product/variant/option rows
   - Upload CSV
   - System validates and imports in sequence
   - Shows success message with counts

## Workflows

### Key Flow 1: Product Selection in Calculator
1. User opens calculator page
2. System fetches all active products from `/api/products`
3. User toggles view mode (dropdown or gallery)
4. **Gallery Mode**:
   - Products displayed as cards with thumbnails
   - User clicks card to select
5. **Dropdown Mode**:
   - Products in select dropdown
   - User types to filter and selects
6. System fetches variants for selected product
7. Default variant auto-selected (if configured)
8. System fetches options for selected product
9. Options render in order:
   - Top-level options first
   - Child options nested under parents
   - Default values pre-populated
10. User proceeds to enter dimensions and calculate

### Key Flow 2: Option Configuration with Dependencies
1. Product selected with options loaded
2. Top-level toggle option "Add Grommets" displayed
3. Child option "Grommet Spacing" (select type) hidden initially
4. User enables "Add Grommets" toggle
5. System checks parent state, reveals child option
6. "Grommet Spacing" dropdown appears with choices: "4 Corners", "8 Grommets"
7. User selects "4 Corners"
8. System evaluates both option formulas:
   - Parent: `setupCost` = $25
   - Child: `eqstr(value, "4 Corners") ? 10 : eqstr(value, "8 Grommets") ? 20 : 0` = $10
9. Total options cost: $35
10. User disables "Add Grommets" toggle
11. Child option disappears, both costs removed
12. Total options cost: $0

### Key Flow 3: Product Cloning (Admin)
1. Admin navigates to product management page
2. Finds product to clone in list
3. Clicks "Clone" action button
4. Backend receives clone request
5. System fetches original product with all relations:
   - Product details
   - All variants (3 variants)
   - All options (5 options, 2 have parent-child relationship)
6. System creates new product:
   - New UUID generated
   - Name appended with " (Copy)"
   - All other fields duplicated
7. System creates new variants:
   - 3 new UUIDs generated
   - productId points to new product
   - All fields (name, pricing, etc.) copied
8. System creates new options:
   - 5 new UUIDs generated
   - productId points to new product
   - Parent-child relationships re-mapped to new option IDs
   - All fields (type, formulas, etc.) copied
9. System returns cloned product ID
10. Admin redirected to edit page for new product
11. Admin can modify clone as needed

### Key Flow 4: CSV Bulk Import
1. Admin clicks "Download Template" button
2. System generates CSV with example rows
3. Admin opens in spreadsheet software
4. Admin fills in rows:
   - Row 1: Type=PRODUCT, Product Name="Banners", Description="Custom banners"
   - Row 2: Type=VARIANT, Product Name="Banners", Variant Name="13oz Vinyl", Base Price Per Sqft="0.05"
   - Row 3: Type=VARIANT, Product Name="Banners", Variant Name="Mesh", Base Price Per Sqft="0.06"
   - Row 4: Type=OPTION, Product Name="Banners", Option Name="Lamination", Type="toggle", Setup Cost="25"
5. Admin saves CSV and uploads via import interface
6. Backend receives CSV data as string
7. System parses with PapaParse library
8. System validates structure and required fields
9. System processes in order:
   - Create "Banners" product → Store productId in map
   - Create "13oz Vinyl" variant → Link to product via productId
   - Create "Mesh" variant → Link to product via productId
   - Create "Lamination" option → Link to product via productId
10. System returns import summary: `{ products: 1, variants: 2, options: 1 }`
11. Admin sees success message
12. New products appear in catalog immediately

### State Transitions
- **Product**: Draft → Active ↔ Inactive
- **Product View**: Dropdown ↔ Gallery (user toggle)
- **Option Visibility**: Hidden ↔ Visible (based on parent state)
- **Option Value**: Default → User-Modified
- **Import Status**: Uploaded → Parsing → Validating → Creating → Complete

## RBAC Rules

- **Read Access**:
  - All authenticated users can view active products, variants, options
  - Customers see products in calculator
  - Internal users see all products including inactive

- **Write Access**:
  - **Admin/Owner**: Full CRUD on product types, products, variants, options
  - **Admin/Owner**: Can clone products, import/export CSV
  - **Manager**: Read-only access (cannot modify catalog)
  - **Employee**: No catalog management access
  - **Customer**: No catalog management access

- **Delete Access**:
  - **Admin/Owner**: Can delete products (CASCADE to variants/options)
  - **Admin/Owner**: Can delete product types (blocked if in use)
  - Deletion protection on types referenced by products

- **Import/Export**:
  - **Admin only**: Can download template, export catalog, import CSV
  - Import operations are atomic per row (partial success possible)

## Integration Points

- **Pricing Formula Engine**: Products drive all pricing calculations via formulas or nesting
- **Quotes Module**: Selected options and variants stored in quote line items as snapshots
- **Orders Module**: Product configurations preserved through quote-to-order conversion
- **Calculator Component**: Primary consumer of product catalog for quote building
- **Object Storage**: Thumbnail URLs reference GCS-hosted images with public ACLs
- **Admin Interface**: Product management UI for catalog maintenance

## Known Gaps / TODOs

- **Product Search**: No full-text search on product names/descriptions in calculator
- **Category Filtering**: Categories exist but no UI to filter by category
- **Product Recommendations**: No "related products" or "frequently bought together"
- **Option Groups**: No visual grouping of related options beyond parent-child
- **Variant Swatches**: No color/pattern swatches for visual variant selection
- **Product Reviews**: No customer rating/review system
- **Inventory Linking**: Products not directly linked to inventory (manual mapping required)
- **Multi-language**: All names/descriptions in single language (English)
- **Product Versioning**: No history of product changes over time
- **Advanced CSV**: Import doesn't handle price breaks or volume pricing (must be configured manually)
- **Image Gallery**: Only first thumbnail shown; no multi-image carousel
- **Option Validation**: No cross-option validation rules (e.g., "if A then B required")

## Test Plan

### Manual Testing Steps

**Test 1: Product Type Management**
1. Admin creates product type "Signage" with sortOrder=1
2. Create another type "Banners" with sortOrder=0
3. View product types list
4. Expected: "Banners" appears first due to lower sortOrder
5. Try to delete "Signage" while no products assigned
6. Expected: Delete succeeds
7. Create product in "Banners" type
8. Try to delete "Banners" type
9. Expected: Delete fails with "in use" error

**Test 2: Product Creation and Activation**
1. Admin creates product "Business Cards" with isActive=true
2. Add 2 variants, 3 options
3. Customer opens calculator
4. Expected: "Business Cards" appears in list
5. Admin sets isActive=false on product
6. Customer refreshes calculator
7. Expected: "Business Cards" no longer visible
8. Admin can still edit product

**Test 3: Gallery View Product Selection**
1. Upload thumbnail for product
2. Customer opens calculator, switches to gallery view
3. Expected: Product displays with thumbnail in grid
4. Click product card
5. Expected: Card highlights, "Selected" badge appears
6. Variant dropdown populates with default selected

**Test 4: Dropdown View Product Selection**
1. Customer opens calculator, uses dropdown view
2. Type product name to filter
3. Select product from dropdown
4. Expected: Same behavior as gallery (variant loads, options appear)
5. Switch to gallery view
6. Expected: Selected product highlighted in gallery

**Test 5: Default Variant Selection**
1. Create product with 3 variants
2. Mark variant "Matte" as isDefault=true
3. Customer selects product in calculator
4. Expected: "Matte" variant auto-selected in dropdown
5. Verify price calculation uses Matte's basePricePerSqft

**Test 6: Parent-Child Option Dependencies**
1. Create toggle option "Add Finishing" (parent)
2. Create select option "Finish Type" (child, parentOptionId set)
3. Customer selects product
4. Expected: Only "Add Finishing" toggle visible
5. Enable "Add Finishing" toggle
6. Expected: "Finish Type" dropdown appears below
7. Select finish type, verify pricing includes both options
8. Disable "Add Finishing"
9. Expected: Child option disappears, both costs removed

**Test 7: Toggle Option Behavior**
1. Create toggle option "Lamination" with setupCost=25, formula="setupCost"
2. Customer enables toggle
3. Expected: $25 added to options total
4. Disable toggle
5. Expected: $25 removed from options total
6. Re-enable and calculate quote
7. Expected: Saved quote includes lamination in selectedOptions array

**Test 8: Number Option Behavior**
1. Create number option "Extra Copies" with formula="value * 2.50"
2. Customer enters value=5
3. Expected: $12.50 added to options total (5 * 2.50)
4. Change to value=10
5. Expected: Auto-recalculates to $25.00 (10 * 2.50)
6. Enter invalid value (negative or text)
7. Expected: Validation error, option cost remains at last valid value

**Test 9: Select Option Behavior**
1. Create select option "Grommet Pattern" with defaultValue="4 Corners, 8 Grommets, Custom"
2. Add formula: `eqstr(value, "4 Corners") ? 10 : eqstr(value, "8 Grommets") ? 20 : 30`
3. Customer selects "4 Corners"
4. Expected: $10 added to options total
5. Change to "8 Grommets"
6. Expected: $20 (updated calculation)
7. Change to "Custom"
8. Expected: $30

**Test 10: Product Clone Function**
1. Admin selects product with 3 variants, 5 options (2 parent-child pairs)
2. Click "Clone" button
3. Expected: New product created with name "{Original} (Copy)"
4. Verify 3 variants cloned with new IDs
5. Verify 5 options cloned with parent-child relationships intact
6. Modify clone (change name, pricing)
7. Verify original product unchanged

**Test 11: CSV Template Download**
1. Admin clicks "Download Template"
2. Expected: CSV file downloads with example rows
3. Open in Excel/Google Sheets
4. Verify columns: Type, Product Name, Product Description, Variant Name, Option Name, etc.
5. Verify sample data shows proper format

**Test 12: CSV Import - Products and Variants**
1. Create CSV with:
   - 1 PRODUCT row
   - 2 VARIANT rows for that product
2. Upload via import interface
3. Expected: Success message shows "1 product, 2 variants imported"
4. Verify product appears in catalog
5. Verify both variants present with correct pricing

**Test 13: CSV Import - Options with Parent-Child**
1. Add to CSV:
   - OPTION row: Parent toggle "Add Feature"
   - OPTION row: Child select "Feature Type" with Parent Option Name="Add Feature"
2. Import CSV
3. Expected: Both options created
4. In calculator, verify child only appears when parent enabled
5. Verify parent-child relationship correct

**Test 14: CSV Export Roundtrip**
1. Admin exports existing products to CSV
2. Modify CSV (change variant price, add new option to existing product)
3. Import modified CSV
4. Expected: Changes applied, new option added
5. Verify product still functional in calculator

**Test 15: Thumbnail Management**
1. Admin uploads 3 images for product
2. Verify first image shows in gallery view
3. Update thumbnails (remove first, add new)
4. Verify gallery updates with new first image
5. Remove all thumbnails
6. Verify placeholder icon displays

**Test 16: Store Link Display**
1. Create product with storeUrl="https://example.com/product"
2. Set showStoreLink=true
3. Customer selects product in calculator
4. Expected: "View in Store" button appears
5. Click button
6. Expected: Opens in new tab to correct URL
7. Admin sets showStoreLink=false
8. Expected: Button no longer visible

**Test 17: Option Display Order**
1. Create 5 options with displayOrder values: 2, 0, 4, 1, 3
2. Customer selects product
3. Expected: Options appear in order 0, 1, 2, 3, 4 (not creation order)
4. Verify parent-child groups stay together

**Test 18: Inactive Variant Filtering**
1. Create product with 3 variants
2. Set middle variant isActive=false
3. Customer selects product
4. Expected: Only 2 variants visible in dropdown
5. Admin can still see and edit inactive variant

**Test 19: Multi-Product Quote with Different Options**
1. Add Product A with options (lamination, grommets)
2. Configure and add to quote
3. Select Product B with different options (finishing, binding)
4. Configure and add to quote
5. Expected: Both line items in cart with their respective options
6. Verify totals calculate independently
7. Save quote
8. Expected: Each line item preserves its option selections

**Test 20: Error Handling - Invalid Import Data**
1. Create CSV with invalid data:
   - Missing required Product Name
   - Invalid option type "dropdown" (should be "select")
   - Negative basePricePerSqft
2. Attempt import
3. Expected: Import fails with clear error messages
4. Fix errors and retry
5. Expected: Import succeeds

### Expected Results
- Product types sort correctly by sortOrder
- Gallery and dropdown views show same products
- Default variants auto-select
- Parent-child option dependencies enforce correctly
- All option types calculate prices accurately
- Product cloning preserves all configurations
- CSV import/export maintains data integrity
- Thumbnails display properly with fallbacks
- Store links open correctly when enabled
- Inactive items hidden from customers but visible to admin
- Multi-product quotes handle independent configurations
- Error messages clear and actionable

## Files Added/Modified

### Core Schema & Backend
- **`shared/schema.ts`**: 
  - ProductType, Product, ProductVariant, ProductOption schemas
  - Zod validation with insert/update variants
  - JSON type definitions for volumePricing, priceBreaks
  - Relations defined for all entities

- **`server/storage.ts`**:
  - Product type CRUD methods
  - Product CRUD methods including `cloneProduct`
  - Variant CRUD methods
  - Option CRUD methods with parent-child awareness

- **`server/routes.ts`**:
  - Product type endpoints (GET, POST, PATCH, DELETE)
  - Product endpoints including clone and thumbnail management
  - Variant endpoints (CRUD)
  - Option endpoints (CRUD)
  - CSV import/export endpoints with PapaParse integration

### Migrations
- **`migrations/0000_cool_taskmaster.sql`**: Initial schema for product catalog tables
- Subsequent migrations add pricing-specific fields (see Pricing Formula Engine doc)

### Frontend Components
- **`client/src/components/calculator.tsx`**:
  - Product view mode toggle (dropdown/gallery)
  - Gallery view with thumbnail cards
  - Dropdown product selector
  - Variant selector with custom label
  - Dynamic option rendering (toggle/number/select)
  - Parent-child option visibility logic
  - Store link button
  - Product description display

- **Product management UI** (admin interfaces):
  - Product CRUD forms with all fields
  - Variant management table
  - Option builder with parent selector
  - Thumbnail uploader
  - CSV import/export interface

### Supporting Files
- **`client/src/components/ui/*`**: Button, Card, Input, Select, Switch, Badge, Skeleton
- **`client/src/hooks/useProductTypes.ts`**: Product type fetching (if exists)
- **`server/objectStorage.ts`**: Image upload and ACL management for thumbnails

## Next Suggested Kernel Phase

Based on the current architecture and identified gaps:

**Phase: Advanced Catalog & Customer Experience**
