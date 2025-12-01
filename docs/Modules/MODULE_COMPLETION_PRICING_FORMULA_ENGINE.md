# TITAN KERNEL Module Completion Document — Pricing Formula Engine

## Module Purpose
The Pricing Formula Engine is the mathematical core of QuoteVaultPro's quoting system, providing flexible and powerful price calculation capabilities. It solves the business problem of:
- **Dynamic Pricing**: Calculate prices using custom mathematical formulas that adapt to product dimensions, quantities, and customer-specific variables
- **Material Optimization**: Intelligently nest pieces on sheet materials to minimize waste and maximize profitability
- **Volume Discounts**: Automatically apply tiered pricing based on quantity, sheets used, or square footage
- **Reusable Logic**: Create formula templates and global variables that can be shared across multiple products
- **Real-time Calculation**: Provide instant pricing feedback as users configure products with options

## Data Model Summary

### Tables
- **`products`**: Core product catalog
  - `id`, `name`, `description`, `productTypeId`
  - `pricingFormula` (text, nullable): Custom mathjs formula (e.g., "basePrice * quantity * 1.15")
  - `variantLabel` (varchar): Label for variant dropdown (e.g., "Material Type", "Media")
  - `useNestingCalculator` (boolean): Toggle between formula or nesting-based pricing
  - `sheetWidth`, `sheetHeight` (decimal, nullable): Material dimensions for nesting
  - `materialType` (varchar): "sheet" or "roll"
  - `minPricePerItem` (decimal, nullable): Floor price per piece
  - `nestingVolumePricing` (jsonb): Product-level volume pricing tiers
  - `priceBreaks` (jsonb): Quantity/sheets/sqft-based discount rules
  - Timestamps: `createdAt`, `updatedAt`

- **`productVariants`**: Material/finish options with individual pricing
  - `id`, `productId`, `name`, `description`
  - `basePricePerSqft` (decimal): Core pricing basis for calculations
  - `volumePricing` (jsonb): Variant-level volume tiers (overrides product-level)
  - `isDefault` (boolean), `displayOrder` (integer)
  - `isActive` (boolean)
  - Timestamps: `createdAt`, `updatedAt`

- **`productOptions`**: Add-ons with custom pricing logic
  - `id`, `productId`, `name`, `description`
  - `type` (varchar): "toggle" | "number" | "select"
  - `defaultValue`, `defaultSelection`, `isDefaultEnabled`
  - `setupCost` (decimal): Base cost for the option
  - `priceFormula` (text, nullable): Custom formula for dynamic option pricing
  - `parentOptionId` (varchar, nullable, self-referencing FK): Enables hierarchical dependencies
  - `displayOrder` (integer), `isActive` (boolean)
  - Timestamps: `createdAt`, `updatedAt`

- **`globalVariables`**: Reusable pricing constants
  - `id`, `name`, `value` (text), `description`
  - `category` (varchar): Organizational grouping
  - `isActive` (boolean)
  - Timestamps: `createdAt`, `updatedAt`

- **`formulaTemplates`**: Pre-built formula library
  - `id`, `name`, `description`, `formula` (text)
  - `category` (varchar), `isActive` (boolean)
  - Timestamps: `createdAt`, `updatedAt`

### Relationships
- `products.productTypeId -> productTypes.id` (FK)
- `productVariants.productId -> products.id` (CASCADE on delete)
- `productOptions.productId -> products.id` (CASCADE on delete)
- `productOptions.parentOptionId -> productOptions.id` (CASCADE on delete)

### Key JSON Structures

**priceBreaks** (on products):
```json
{
  "enabled": true,
  "type": "quantity" | "sheets" | "sqft",
  "tiers": [
    {
      "minValue": 100,
      "maxValue": 499,
      "discountType": "percentage" | "fixed" | "multiplier",
      "discountValue": 10
    }
  ]
}
```

**volumePricing** (on variants and nestingVolumePricing on products):
```json
{
  "enabled": true,
  "tiers": [
    {
      "minSheets": 5,
      "maxSheets": 9,
      "pricePerSheet": 45.00
    }
  ]
}
```

**selectedOptions** (stored on quote/order line items):
```json
[
  {
    "optionId": "uuid",
    "optionName": "Lamination",
    "value": true | 5.5 | "Gloss",
    "setupCost": 25.00,
    "calculatedCost": 30.00
  }
]
```

## Backend Summary

### Migrations
- **`0000_cool_taskmaster.sql`**: Initial product catalog setup
- **`0003_add_nesting_calculator.sql`**: Added `useNestingCalculator`, `sheetWidth`, `sheetHeight`, `materialType`, `minPricePerItem`, `nestingVolumePricing` fields
- **`0004_make_pricing_formula_optional.sql`**: Made `pricingFormula` nullable to support nesting-only products
- **`0006_move_volume_pricing_to_variants.sql`**: Moved volume pricing from product-level to variant-level for greater flexibility

### Schema (`shared/schema.ts`)
- `insertProductSchema`, `updateProductSchema` with Zod validation
- `insertProductVariantSchema`, `updateProductVariantSchema`
- `insertProductOptionSchema`, `updateProductOptionSchema`
- `insertGlobalVariableSchema`, `updateGlobalVariableSchema`
- `insertFormulaTemplateSchema`, `updateFormulaTemplateSchema`
- Complex JSON validation for `priceBreaks`, `volumePricing`, `nestingVolumePricing`

### Services & Helpers

**`server/NestingCalculator.js`** (Plain JS class):
- **Constructor**: Accepts `sheetWidth`, `sheetHeight`, `sheetCost`, optional `minPricePerItem` and `volumePricing`
- **`getPricePerSheet(sheetCount)`**: Returns volume-adjusted sheet cost based on tier matching
- **`calculateGridFit(pieceWidth, pieceHeight)`**: Tests single orientation nesting
- **`findOptimalOrientation(pieceWidth, pieceHeight)`**: Tests both vertical/horizontal orientations
- **`testMixedOrientations(pieceWidth, pieceHeight)`**: Advanced nesting that tries:
  - Pure vertical grid
  - Pure horizontal grid
  - Mixed patterns (vertical rows + horizontal rows)
  - Tests both sheet orientations (48×96 and 96×48) for consistency
- **`analyze(pieceWidth, pieceHeight)`**: Returns comprehensive nesting analysis with all options ranked
- **`calculatePricingWithWaste(pieceWidth, pieceHeight, quantity)`**: Primary pricing method that:
  - Validates piece fits on sheet
  - Finds optimal nesting pattern using mixed orientations
  - Calculates full sheets needed
  - Handles partial sheet with linear foot rounding (12" increments)
  - Accounts for waste (24"+ width = sellable waste)
  - Applies volume pricing
  - Enforces minimum price per item

**`server/storage.ts`** (Pricing-related methods):
- **Product CRUD**: `createProduct`, `updateProduct`, `deleteProduct`, `getProductById`, `getAllProducts`
- **Variant CRUD**: `createProductVariant`, `updateProductVariant`, `deleteProductVariant`, `getProductVariants`
- **Option CRUD**: `createProductOption`, `updateProductOption`, `deleteProductOption`, `getProductOptions`
- **Global Variables**: `createGlobalVariable`, `updateGlobalVariable`, `deleteGlobalVariable`, `getAllGlobalVariables`
- **Formula Templates**: `createFormulaTemplate`, `updateFormulaTemplate`, `deleteFormulaTemplate`, `getAllFormulaTemplates`, `getProductsByFormulaTemplate`

### Business Rules

1. **Formula Evaluation Priority**:
   - If `useNestingCalculator` is true and sheet dimensions exist → Use NestingCalculator
   - Otherwise → Evaluate `pricingFormula` with mathjs
   - At least one must be configured

2. **Formula Context Variables**:
   - `width`, `height`, `quantity`, `sqft` (calculated as width*height/144)
   - `basePricePerSqft` (from selected variant)
   - Single-letter aliases: `w`, `h`, `q`, `p`
   - All global variables (by name)

3. **Option Formula Evaluation**:
   - Toggle options: Skip if false, include if true
   - Number options: Must be finite positive number
   - Select options: Use special `eqstr(value, "text")` pattern matching (safe, no code execution)
   - Child options: Only evaluate if parent toggle is enabled

4. **Volume Pricing Precedence**:
   - Variant-level volumePricing overrides product-level nestingVolumePricing
   - Applied based on total sheets needed in the order

5. **Price Break Application**:
   - Compare value based on type (quantity, sheets, sqft)
   - Find applicable tier (minValue ≤ compareValue ≤ maxValue)
   - Apply discount: percentage (% off), fixed ($ off), multiplier (scale total)

6. **Nesting Calculator Rules**:
   - Piece must fit in at least one orientation (error if oversized)
   - Mixed orientations maximize pieces per sheet
   - Partial sheet height rounded to next linear foot (12")
   - Waste ≥24" wide is considered sellable
   - Average cost per piece = totalPrice / quantity

7. **Minimum Price Enforcement**:
   - If `minPricePerItem` is set, ensure price per piece meets or exceeds it
   - Applied after all calculations (volume pricing, nesting, etc.)

## API Summary

### Routes (`server/routes.ts`)

#### Price Calculation
**POST `/api/quotes/calculate`** (authenticated)
- **Input**: `{ productId, variantId?, width, height, quantity, selectedOptions }`
- **Process**:
  1. Fetch product, variant, options, and global variables
  2. Build formula context (dimensions, pricing basis, globals)
  3. Calculate base price using nesting calculator or formula evaluation
  4. Evaluate each selected option's formula
  5. Sum base + options = subtotal
  6. Apply price breaks if enabled
  7. Return total with detailed breakdown
- **Response**: `{ price, breakdown: { basePrice, optionsPrice, subtotal, priceBreakDiscount, total, selectedOptions, nestingDetails } }`
- **Error Handling**: Validates inputs, catches formula errors, oversized pieces

#### Products
- **GET `/api/products`**: List all products
- **GET `/api/products/:id`**: Get single product
- **POST `/api/products`** (admin): Create product
- **PATCH `/api/products/:id`** (admin): Update product
- **DELETE `/api/products/:id`** (admin): Delete product
- **POST `/api/products/:id/clone`** (admin): Duplicate product with all variants/options
- **PUT `/api/products/:id/thumbnails`** (admin): Update product images

#### Product Variants
- **GET `/api/products/:id/variants`**: List variants for product
- **POST `/api/products/:id/variants`** (admin): Create variant
- **PATCH `/api/products/:productId/variants/:id`** (admin): Update variant
- **DELETE `/api/products/:productId/variants/:id`** (admin): Delete variant

#### Product Options
- **GET `/api/products/:id/options`**: List options for product
- **POST `/api/products/:id/options`** (admin): Create option
- **PATCH `/api/products/:productId/options/:id`** (admin): Update option
- **DELETE `/api/products/:productId/options/:id`** (admin): Delete option

#### Global Variables
- **GET `/api/global-variables`**: List all variables
- **POST `/api/global-variables`** (admin): Create variable
- **PATCH `/api/global-variables/:id`** (admin): Update variable (validates next_quote_number against existing max)
- **DELETE `/api/global-variables/:id`** (admin): Delete variable

#### Formula Templates
- **GET `/api/formula-templates`** (admin): List all templates
- **GET `/api/formula-templates/:id`** (admin): Get single template
- **GET `/api/formula-templates/:id/products`** (admin): Find products using this template
- **POST `/api/formula-templates`** (admin): Create template
- **PATCH `/api/formula-templates/:id`** (admin): Update template
- **DELETE `/api/formula-templates/:id`** (admin): Delete template

#### CSV Import/Export
- **GET `/api/products/csv-template`** (admin): Download CSV template
- **POST `/api/products/import`** (admin): Bulk import products/variants/options from CSV
- **GET `/api/products/export`** (admin): Export all products to CSV

### Validation Schemas (Zod)
- All schemas validate required fields, data types, and constraints
- `insertProductSchema`: Requires name, description; validates optional nesting fields
- `insertProductVariantSchema`: Requires basePricePerSqft as positive number
- `insertProductOptionSchema`: Validates type enum, setupCost as non-negative
- Number fields coerced with `z.coerce.number()` for string/number input flexibility

## Frontend Summary

### Pages
None specific to pricing engine (integrated into calculator and admin product management)

### Components

**`client/src/components/calculator.tsx`** (Core pricing UI):
- **State Management**: Selected product/variant, dimensions, quantity, options, calculated price, line items
- **Product Selection**: Dropdown or gallery view with thumbnail support
- **Dimension Inputs**: Width/height with validation (must be positive, finite)
- **Variant Selection**: Dropdown with base price display
- **Options Rendering**: Dynamic based on type:
  - Toggle: Switch component with enable/disable
  - Number: Input field with step validation
  - Select: Dropdown with predefined choices
  - Parent-child: Children only visible when parent toggle is enabled
- **Auto-calculation**: useEffect triggers recalculation when inputs change
- **Price Display**: Shows total with detailed breakdown (base, options, nesting details, discounts)
- **Line Items Management**: Add to quote, review cart, adjust quantities, remove items
- **Quote Saving**: Persist to backend with customer info

**`client/src/components/admin-settings.tsx`**:
- Global variables management (create, edit, delete)
- Company settings with default tax rate and margin

**Product Management** (referenced in routes but UI distributed):
- Product CRUD with formula editor
- Variant management with pricing tiers
- Option builder with formula input
- CSV import/export interface

### Hooks
- **`useProductTypes`** (via useQuery): Fetch product types
- **`useAuth`**: Current user context for role-based features
- **Calculator queries**:
  - `/api/products`: Product catalog
  - `/api/products/:id/variants`: Variant options
  - `/api/products/:id/options`: Product options
  - `/api/global-variables`: Available variables for formulas

### Key Interactions

1. **Configure Product**:
   - Select product → Auto-select default variant
   - Enter dimensions and quantity
   - Toggle/adjust options → Auto-recalculate price
   - View breakdown with nesting details (if applicable)

2. **Build Quote**:
   - Add configured item to line items cart
   - Repeat for multiple products
   - Review quote total
   - Save quote to backend

3. **Admin Formula Management**:
   - Create/edit product with formula or nesting toggle
   - Define variants with base pricing
   - Build option tree with dependencies
   - Test formulas with calculator

## Workflows

### Key Flow 1: Formula-Based Pricing Calculation
1. User selects product (formula-based)
2. System loads product variants and options
3. User selects variant → Sets `basePricePerSqft` context variable
4. User enters width, height, quantity
5. System calculates `sqft = (width * height) / 144`
6. User toggles/adjusts options
7. For each option:
   - If toggle and false: Skip
   - If parent option exists and parent is disabled: Skip
   - Evaluate option's `priceFormula` with context + option value
   - Add to `optionsPrice`
8. System evaluates product `pricingFormula` with full context → `basePrice`
9. `subtotal = basePrice + optionsPrice`
10. Apply price breaks if enabled → Calculate discount
11. `total = subtotal - discount`
12. Return price with detailed breakdown

### Key Flow 2: Nesting-Based Pricing Calculation
1. User selects product (nesting-enabled)
2. System loads sheet dimensions (`sheetWidth`, `sheetHeight`) and variant pricing
3. User enters piece dimensions (width, height) and quantity
4. System initializes NestingCalculator:
   - `sheetSqft = (sheetWidth * sheetHeight) / 144`
   - `sheetCost = basePricePerSqft * sheetSqft`
5. NestingCalculator finds optimal nesting:
   - Test pure vertical grid: `Math.floor(sheetWidth/pieceWidth) * Math.floor(sheetHeight/pieceHeight)`
   - Test pure horizontal grid: `Math.floor(sheetWidth/pieceHeight) * Math.floor(sheetHeight/pieceWidth)`
   - Test mixed patterns: Rows of vertical + rows of horizontal
   - Test both sheet orientations for consistency
   - Select pattern with most pieces per sheet
6. Calculate sheets needed: `Math.ceil(quantity / maxPiecesPerSheet)`
7. Apply volume pricing if enabled → Adjust `sheetCost` based on tier
8. Calculate price: `pricePerPiece = sheetCost / maxPiecesPerSheet`
9. Apply minimum price if configured: `pricePerPiece = Math.max(pricePerPiece, minPricePerItem)`
10. Calculate partial sheet waste (if applicable)
11. Return total with nesting details (pieces per sheet, pattern, waste info)

### Key Flow 3: Quote Creation with Calculated Prices
1. User configures product(s) in calculator
2. For each configuration:
   - Calculate price using formula or nesting
   - Click "Add to Quote"
   - Store as line item draft (tempId, all specs, price, breakdown)
3. User reviews line items, can remove or adjust
4. User enters customer name (optional)
5. Click "Save Quote"
6. System creates quote record with:
   - Auto-incremented quote number
   - Source (internal or customer_quick_quote)
   - Pricing totals (subtotal, tax, margin, discount, total)
   - Line items array with all pricing details
7. Optionally convert to order later

### State Transitions
- **Product Configuration**: Draft → Calculated → Added to Cart
- **Price Calculation**: Requested → Validated → Computed → Returned
- **Quote**: Unsaved Line Items → Saved Quote → Converted to Order

## RBAC Rules

- **Read Access**:
  - All authenticated users can view products, variants, options
  - All authenticated users can use the pricing calculator
  - Customers can only see their own quotes

- **Write Access**:
  - **Admin/Owner**: Full CRUD on products, variants, options, global variables, formula templates
  - **Manager**: Read-only access to admin features (no modification)
  - **Employee**: Can create quotes, no product configuration access
  - **Customer**: Can create quick quotes, no admin access

- **Delete Access**:
  - **Admin/Owner**: Can delete products (cascade deletes variants/options)
  - Deletion blocked if product is referenced in existing quotes/orders

## Integration Points

- **Quotes Module**: Pricing engine drives quote line item pricing; saved with full breakdown
- **Orders Module**: Quote-to-order conversion preserves pricing breakdown in order line items
- **Products & Variants**: Core data source for all pricing calculations
- **Global Variables**: Shared across all formula evaluations for consistency
- **Jobs & Production**: Order line items include nesting snapshot (`nestingConfigSnapshot`) for production planning
- **Inventory**: Nesting details inform material usage calculations

## Known Gaps / TODOs

- **Formula Validation**: No pre-validation of formula syntax before saving (fails at calculation time)
- **Formula Testing UI**: No admin interface to test formulas with sample inputs
- **Price History**: No tracking of price changes over time for analysis
- **Multi-currency**: All pricing in single currency (USD assumed)
- **Complex Discounts**: Limited to simple price breaks; no customer-specific pricing contracts
- **API Rate Limiting**: No throttling on calculation endpoint (potential abuse vector)
- **Audit Trail**: Formula changes not logged in audit system
- **Advanced Nesting**: Linear nesting (for contour-cut pieces) not supported
- **Material Grain Direction**: Not considered in nesting optimization
- **Waste Management**: Waste tracking exists but no inventory system integration for offcut reuse

## Test Plan

### Manual Testing Steps

**Test 1: Formula-Based Pricing**
1. Create product with formula: `basePricePerSqft * sqft * quantity * 1.2`
2. Add variant with `basePricePerSqft = 0.50`
3. In calculator, select product and variant
4. Enter: width=24, height=36, quantity=10
5. Expected: `sqft = 24*36/144 = 6`, `basePrice = 0.50 * 6 * 10 * 1.2 = 36.00`
6. Verify price displays $36.00

**Test 2: Nesting Calculator**
1. Create product with nesting enabled
2. Set sheet: 48×96, variant price: $0.05/sqft (sheet cost = $32)
3. Enter piece: 12×24, quantity=30
4. Expected: 12 pieces per sheet (4 wide × 3 high), 3 sheets needed
5. Price per piece: $32/12 = $2.67, total = $2.67 * 30 = $80.00
6. Verify nesting details show "12 pieces per sheet (4×3 grid)"

**Test 3: Product Options with Formulas**
1. Create product with base formula
2. Add toggle option "Lamination" with setupCost=25, formula="setupCost"
3. Add number option "Extra Copies" with formula="value * 2.50"
4. Calculate base price, then enable lamination and set copies=5
5. Expected: options total = 25 + (5 * 2.50) = 37.50
6. Verify breakdown shows both options with costs

**Test 4: Parent-Child Options**
1. Create toggle option "Add Grommets" (parent)
2. Create select option "Grommet Spacing" (child, parentOptionId=grommets)
3. In calculator, verify child only visible when parent enabled
4. Toggle parent off, verify child disappears and its cost removed

**Test 5: Volume Pricing**
1. Create product with nesting, sheet cost $32
2. Add volume pricing: 5-9 sheets = $28, 10+ sheets = $25
3. Calculate 12×24 pieces:
   - 50 pieces = 5 sheets → Should use $28/sheet
   - 120 pieces = 10 sheets → Should use $25/sheet
4. Verify pricing adjusts correctly

**Test 6: Price Breaks**
1. Enable price breaks: type="quantity", tiers=[{minValue:100, discountType:"percentage", discountValue:10}]
2. Calculate with quantity=50 → No discount
3. Calculate with quantity=150 → 10% discount applied
4. Verify breakdown shows discount

**Test 7: Minimum Price Per Item**
1. Create product with nesting, set minPricePerItem=5.00
2. Calculate small pieces that would cost $2.00 each
3. Verify price adjusted to $5.00 per piece
4. Verify larger pieces (e.g., $8.00 each) not affected

**Test 8: Global Variables**
1. Create global variable: markup=1.35
2. Create product formula: `basePricePerSqft * sqft * quantity * markup`
3. Calculate price, verify markup applied
4. Update variable to 1.50
5. Recalculate, verify new markup used

**Test 9: Mixed Orientation Nesting**
1. Product: 48×96 sheet, piece: 30×40, quantity=6
2. Expected: Find pattern like "4 vertical + 2 horizontal" or similar
3. Verify nesting details show mixed pattern
4. Verify all 6 pieces fit efficiently

**Test 10: CSV Import/Export**
1. Export existing products to CSV
2. Modify CSV (change prices, add new product)
3. Import CSV
4. Verify changes applied correctly
5. Verify new product appears in catalog

### Expected Results
- All calculations produce finite, positive numbers
- Nesting patterns maximize pieces per sheet
- Options only calculate when conditions met
- Parent-child relationships enforced
- Volume pricing applies correct tier
- Price breaks calculate discount properly
- Minimum prices enforced consistently
- Global variables resolve correctly
- Import/export maintains data integrity
- Error messages clear and actionable

## Files Added/Modified

### Core Schema & Backend
- **`shared/schema.ts`**: Products, variants, options schemas with Zod validation; priceBreaks and volumePricing JSON types
- **`server/storage.ts`**: Product/variant/option CRUD methods; global variables and formula templates
- **`server/routes.ts`**: 
  - `/api/quotes/calculate` endpoint (formula evaluation and nesting calculation)
  - Product CRUD routes with validation
  - Variant/option management routes
  - Global variable routes
  - Formula template routes
  - CSV import/export routes
- **`server/NestingCalculator.js`**: Complete nesting optimization algorithm with mixed orientations, waste accounting, volume pricing

### Migrations
- **`migrations/0000_cool_taskmaster.sql`**: Initial product catalog tables
- **`migrations/0003_add_nesting_calculator.sql`**: Added nesting calculator fields to products
- **`migrations/0004_make_pricing_formula_optional.sql`**: Made pricingFormula nullable
- **`migrations/0006_move_volume_pricing_to_variants.sql`**: Moved volume pricing to variants table

### Frontend Components
- **`client/src/components/calculator.tsx`**: Complete pricing calculator UI with auto-calculation, option rendering, line item management
- **`client/src/components/admin-settings.tsx`**: Global variables management UI
- **Product management pages**: Distributed across admin interfaces for CRUD operations

### Supporting Files
- **`client/src/hooks/useProductTypes.ts`**: Product type fetching hook (if exists)
- **`client/src/components/ui/*`**: Reusable UI components (Button, Input, Select, Switch, Card, etc.)

## Next Suggested Kernel Phase

Based on the current system architecture and roadmap:

**Phase: Advanced Pricing & Customer-Specific Rules**
1. **Customer Price Contracts**: 
   - Add customer-specific pricing overrides
   - Contract-based volume discounts
   - Customer price tiers (Gold/Silver/Bronze)
   
2. **Price Validation & Testing**:
   - Admin formula testing interface with sample inputs
   - Pre-save formula syntax validation
   - Price simulation for "what-if" scenarios

3. **Cost Analysis & Margins**:
   - Track actual material costs vs. quoted prices
   - Margin analysis reports
   - Cost history tracking for trend analysis

4. **Enhanced Nesting**:
   - Linear nesting for contour-cut pieces
   - Multi-sheet optimization across different materials
   - Grain direction consideration
   - Waste/offcut inventory tracking

5. **Multi-currency Support**:
   - Currency selection per quote/customer
   - Exchange rate integration
   - Currency-specific pricing rules

6. **Formula Library Enhancement**:
   - Searchable formula repository
   - Formula versioning and rollback
   - Formula usage analytics
   - Shared formula marketplace

7. **Advanced Discounts**:
   - Seasonal pricing calendars
   - Bundle discounts (buy X get Y)
   - Promotional codes
   - Customer loyalty discounts
