# Pricing Calculator Web Application

## Overview

A professional pricing calculator web application for generating quotes on print products (business cards, postcards, flyers, brochures, banners, etc.). The system supports multi-user authentication, quote history tracking, and admin capabilities for managing products and viewing system-wide analytics.

**Core Purpose**: Enable sales teams to quickly generate accurate pricing quotes for custom print products based on dimensions, quantities, and add-on options, while maintaining a centralized quote history and administrative oversight.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture

**Framework**: React 18 with TypeScript using Vite as the build tool

**UI Component System**: 
- Shadcn/ui component library (New York style variant) built on Radix UI primitives
- Tailwind CSS for styling with custom design tokens
- Material Design-inspired approach prioritizing clarity and data density for B2B productivity

**State Management**:
- TanStack Query (React Query) for server state management and data fetching
- React Hook Form with Zod validation for form state
- Local component state with React hooks

**Routing**: Wouter for lightweight client-side routing

**Design System**:
- Typography: Inter font for UI elements, JetBrains Mono for pricing/numerical data
- Spacing: Tailwind's 8-point grid system (units of 2, 4, 6, 8)
- Responsive: Mobile-first with breakpoints for desktop layouts
- Theme: Light mode with customizable HSL color system via CSS variables

### Backend Architecture

**Runtime**: Node.js with Express.js server

**API Pattern**: RESTful JSON API with session-based authentication

**Database Access**: 
- Drizzle ORM for type-safe database operations
- PostgreSQL as the primary database (via Neon serverless)
- Schema-first approach with TypeScript types derived from Drizzle schemas

**Authentication Strategy**:
- Replit OIDC-based authentication using OpenID Connect
- Session management with connect-pg-simple for PostgreSQL-backed sessions
- Passport.js for authentication middleware
- Role-based access control (standard users vs. admin users)

**Key Architectural Decisions**:
1. **Monorepo Structure**: Single repository with `client/`, `server/`, and `shared/` directories for code organization and type sharing
2. **Type Safety**: Shared TypeScript schemas between frontend and backend using Zod for runtime validation
3. **Session Storage**: PostgreSQL-backed sessions for scalability and persistence across server restarts
4. **Path Aliases**: TypeScript path mapping (`@/`, `@shared/`, `@assets/`) for cleaner imports

### Data Models

**Core Entities**:

1. **Users**: Authenticated users with profile information and admin flags
2. **Products**: Print product definitions with pricing formulas and descriptions
3. **Product Options**: Configurable add-on options for products (e.g., grommets, pole pockets, lamination)
4. **Quotes**: Generated price quotes with customer info, dimensions, quantities, selected options, and calculated prices
5. **Pricing Rules**: Configurable pricing formulas and discount tiers (admin-managed)
6. **Sessions**: Server-side session storage for authentication state

**Key Relationships**:
- Users → Quotes (one-to-many): Each user can generate multiple quotes
- Products → Quotes (one-to-many): Each product can appear in multiple quotes
- Products → Product Options (one-to-many): Each product can have multiple configurable options
- Product Options → Product Options (one-to-many): Parent-child hierarchy for nested options (max 2 layers)
- Quotes include denormalized product/user data and selected options for historical accuracy

**Pricing Calculation Engine**:
- Formula-based pricing stored as strings in product records
- Runtime evaluation of formulas with dimension and quantity inputs using mathjs
- Dynamic product options system with three option types:
  - **Toggle options**: Boolean on/off switches (e.g., "Add Grommets")
  - **Number options**: Numeric inputs for quantities (e.g., "Number of Pole Pockets")
  - **Select options**: Dropdown menus for predefined choices (e.g., "Lamination Type: Matte/Gloss")
- Each option supports:
  - Setup costs (one-time charges)
  - JavaScript pricing formulas with access to dimensions (width, height) and quantities
  - Default enabled/disabled state and default values
  - 2-layer parent-child hierarchy (child options only appear when parent is active)
- Safe formula evaluation with mathjs library prevents code injection
- Admin-configurable products, options, and formulas without code deployment

### Application Features

**User Capabilities**:
- Calculate quotes: Select product, enter dimensions/quantity, configure dynamic product options
- View quote history: Filter by customer, product, date range, price range, view selected options
- Save and retrieve quotes for repeat customers with option selections preserved
- Email quotes to customers

**Admin Capabilities**:
- View all quotes across all users system-wide with selected options visible
- Advanced filtering: by user/salesperson, customer, product, quantity ranges
- Product management: CRUD operations on product catalog
- Product options management: Create/edit/delete configurable options per product
  - Define option types (toggle/number/select)
  - Set default values and enabled states
  - Configure setup costs and pricing formulas
  - Organize options in 2-layer hierarchy
- Formula management: Edit pricing formulas and discount rules
- Analytics: User activity tracking and CSV export for production planning including option details

**UI Components**:
- Calculator interface: Two-column layout (product selection + dynamic options | price display with breakdown)
- Quote history table: Searchable/filterable data grid with selected options displayed as badges
- Admin dashboard: Multi-column metrics and system-wide quote table with option visibility
- Admin settings: Tabbed interface for product, product options, and formula management
  - Product options tree view showing parent-child relationships
  - Inline editing and deletion with confirmation dialogs

## External Dependencies

### Third-Party Services

**Authentication**: 
- Replit OIDC (OpenID Connect) for user authentication
- Issuer URL: `https://replit.com/oidc` (configurable via environment)

**Database**:
- Neon PostgreSQL serverless database
- Connection via WebSocket for serverless compatibility
- Required environment variable: `DATABASE_URL`

### Key NPM Packages

**Frontend**:
- `@tanstack/react-query`: Server state management and caching
- `wouter`: Lightweight routing
- `react-hook-form`: Form state management
- `zod`: Runtime schema validation
- `@radix-ui/*`: Headless UI component primitives
- `tailwindcss`: Utility-first CSS framework
- `date-fns`: Date manipulation and formatting

**Backend**:
- `express`: Web server framework
- `drizzle-orm`: Type-safe ORM
- `@neondatabase/serverless`: Neon PostgreSQL client
- `openid-client`: OpenID Connect client
- `passport`: Authentication middleware
- `express-session`: Session management
- `connect-pg-simple`: PostgreSQL session store
- `mathjs`: Safe mathematical expression evaluation for pricing formulas

**Shared/Build Tools**:
- `typescript`: Type system
- `vite`: Frontend build tool and dev server
- `esbuild`: Backend bundler for production
- `tsx`: TypeScript execution for development

### Environment Configuration

Required environment variables:
- `DATABASE_URL`: PostgreSQL connection string
- `SESSION_SECRET`: Secret for session encryption
- `REPL_ID`: Replit workspace identifier (for OIDC)
- `ISSUER_URL`: OIDC issuer URL (defaults to Replit)
- `NODE_ENV`: Environment mode (development/production)

### Integration Points

**Email**: Quote email functionality requires SMTP integration (implementation pending)

**CSV Export**: Server-side CSV generation for quote data export with columns for:
- Date, User Email, Customer Name, Product, Width, Height, Quantity
- Selected Options (semicolon-delimited list of option names, values, and costs)
- Options Cost (total additional cost from selected options)
- Total Price

**Product Store Links**: Each product can link to an external online store URL for direct ordering

## Recent Changes

### Product Options System (November 2025)

Implemented comprehensive product options functionality allowing dynamic configuration of add-on features for print products:

**Database Schema:**
- Added `product_options` table with support for 3 option types (toggle/number/select)
- Fields include: name, description, type, defaultValue, isDefaultEnabled, setupCost, priceFormula, parentOptionId, displayOrder, isActive
- Updated `quotes` table to store selectedOptions as JSONB array

**Admin Features:**
- Product Options management UI in Admin Settings
- Tree-structured display showing parent-child option relationships
- CRUD operations with inline editing
- Formula editor for dynamic pricing based on dimensions and quantities

**Calculator Enhancements:**
- Dynamic option rendering based on product selection
- Toggle switches, number inputs, and select dropdowns
- Automatic default value population
- Real-time price calculation with option costs
- Price breakdown showing base price, option costs, and total
- Safe formula evaluation using mathjs library

**Quote History Updates:**
- Options column displaying selected options as badges
- Format: "OptionName: value (+$cost)"
- CSV export includes "Selected Options" and "Options Cost" columns

**Technical Implementation:**
- Shared TypeScript schemas with Zod validation
- Safe formula evaluation preventing code injection
- Field mapping: optionName, value, calculatedCost
- Null-safe rendering with default cost values

### Form Prepopulation & UI Enhancements (November 15, 2025)

Fixed critical UX issues in Admin Settings forms:

**Variant Edit Dialog Fix:**
- **Problem**: Edit variant dialog was not prepopulating fields when editing existing variants
- **Root Cause**: Dialog form fields bound to `variantForm` but `handleEditVariant()` populated `editVariantForm`
- **Solution**: Updated all FormFields in edit variant dialog to use `editVariantForm.control`
- **Impact**: Editing variants now correctly shows existing name, description, base price, display order, and default flag values

**Select Option Multi-Choice UI:**
- **Problem**: No intuitive UI for managing dropdown choices in select-type options; only confusing single text input
- **Solution**: Created `SelectChoicesInput` component with tag-based interface
  - Shows existing choices as removable badges with × buttons
  - Input field + button for adding new choices
  - Enter key support for quick entry
  - Duplicate prevention
  - Stores choices as comma-separated string in `defaultValue` field (compatible with calculator rendering)
- **Impact**: Admin users can easily manage dropdown options (e.g., "Matte, Gloss, Satin" for lamination types)

**Authentication Robustness:**
- **Problem**: OIDC callback crashed on duplicate email when same email used with different OIDC sub
- **Solution**: Enhanced `upsertUser()` to catch unique constraint violations on email and gracefully update existing user profile
- **Impact**: Prevents server crashes during login, handles edge cases like OIDC provider changes

### Nested Dialog Fix (November 15, 2025)

Fixed critical UX issue where product dialog would close unexpectedly when saving variant changes:

**Problem:** When editing a product variant from within the product edit dialog, clicking "Update Material/Variant" would close BOTH dialogs (variant and product), forcing the user to reopen the product dialog to continue editing.

**Root Cause:** The variant edit form was nested inside the product form in the DOM. When the "Update Material" button was clicked, the submit event was bubbling up and triggering BOTH form submissions - updating both the variant AND the product. The product update invalidated the `/api/products` query which caused the product dialog to close.

**Solutions Attempted:**
1. Removing query invalidations from variant mutation - failed, product was still being updated
2. setTimeout delay and manual cache updates - failed, still had two PATCH requests
3. **Final Solution:** Prevent event bubbling from nested variant form

**Implementation:**
- Added `e.stopPropagation()` to the variant form's onSubmit handler
- This prevents the submit event from bubbling up to the parent product form
- Now only the variant mutation runs when "Update Material" is clicked
- Product form remains untouched, so product dialog stays open

**Server Log Evidence:**
- Before fix: Two simultaneous PATCH requests (variant + product) followed by GET /api/products
- After fix: Only one PATCH request (variant only), no product update

**Impact:** Product dialog now stays open when editing variants, allowing admin users to edit multiple variants without repeatedly reopening the product dialog