# DASHBOARD & SETTINGS AUDIT REPORT

**Date:** January 23, 2026  
**Purpose:** Audit current Dashboard and Settings areas to plan reorganization  
**Status:** Planning Phase Only - No Implementation

---

## 1. Dashboard Component Location & Structure

**Route:** `/dashboard`  
**Component File:** `client/src/pages/home.tsx`  
**Main Component:** `Home` (default export)

**Child Components Used:**
- `CalculatorComponent` (`@/components/calculator`)
- `AdminDashboard` (`@/components/admin-dashboard`)
- `AdminSettings` (`@/components/admin-settings`)
- `CustomersPage` (`@/pages/customers`)
- `OrdersPage` (`@/pages/orders`)
- `AuditLogs` (`@/pages/audit-logs`)

---

## 2. Dashboard Content Inventory

### **A. Header Section**
- **Title:** "Dashboard"
- **Subtitle:** "Pricing calculator and quick access to your workspace"
- **Actions:**
  - **Production Button** (Admin-only): Routes to `/production`
  - **View Toggle** (Admin-only): Switch between Admin View / Customer View

### **B. Pending Approvals Alert Card** (Conditional)
- **Visibility:** Shows when `isApprover && requireApproval && pendingApprovalsCount > 0`
- **Purpose:** Alert users to pending quote approvals requiring action
- **Data Source:** `useQuery(["/api/quotes/pending-approvals"])`
- **Action:** "Review N" button → navigates to `/approvals`

### **C. Tabs System** (Main Dashboard Interface)

The Dashboard uses a **tabbed interface** with different layouts based on:
- **Admin View** vs **Customer View** (toggled by switch)
- **User Role** (Owner/Admin/Manager/Employee/Customer)

#### **Tab Structure:**

| Tab Name | Value | Visibility | Purpose | Data Sources |
|----------|-------|------------|---------|--------------|
| **Calculator** | `calculator` | All users | Pricing calculator widget | `CalculatorComponent` |
| **Quotes** | `quotes` | Admin view | Navigate to internal quotes list | Navigates to `/quotes` |
| **My Quotes** | `portal-quotes` | Customer view | Navigate to customer portal quotes | Navigates to `/portal/my-quotes` |
| **My Orders** | `portal-orders` | Customer view | Navigate to customer portal orders | Navigates to `/portal/my-orders` |
| **Contacts** | `contacts` | Admin view | Navigate to contacts list | Navigates to `/contacts` |
| **Orders** | `orders` | Admin view | Embedded OrdersPage | `OrdersPage` component |
| **Admin** | `admin` | Admin-only | Admin metrics & quick links | `AdminDashboard` component |
| **Settings** | `settings` | Admin-only | Settings hub with tabs | `AdminSettings` component |
| **Audit Log** | `audit-logs` | Owner-only | Audit log viewer | `AuditLogs` component |

---

## 3. Dashboard Links Table

### **Links in Dashboard Header/Actions:**

| Link Label | Target Route | Type | Access Control |
|------------|--------------|------|----------------|
| Production (button) | `/production` | Operational | Admin-only (`isAdmin && viewMode === "admin"`) |
| Review N (button) | `/approvals` | Operational | Approver-only (Owner/Admin/Manager/Employee) |

### **Links in Tab Navigation (implicit):**

| Tab Name | Navigates To | Type | Access Control |
|----------|--------------|------|----------------|
| Quotes | `/quotes` | Operational | Admin view |
| My Quotes | `/portal/my-quotes` | Operational | Customer view |
| My Orders | `/portal/my-orders` | Operational | Customer view |
| Contacts | `/contacts` | Operational | Admin view |
| Production | `/production` | Operational | Admin-only (via button) |

### **Links Inside Admin Dashboard Tab:**

**AdminDashboard Component** (`admin-dashboard.tsx`) contains:

| Section | Links/Actions | Target | Type | Access |
|---------|---------------|--------|------|--------|
| Procurement Quick Links | "Go to Vendors" | `/vendors` | Operational | Admin |
| Procurement Quick Links | "Go to POs" | `/purchase-orders` | Operational | Admin |
| Low Stock Materials | Material name links | `/materials/:id` | Operational | Admin |
| All System Quotes | Edit button (per quote) | `/quotes/:id/edit` | Operational | Admin |
| Export CSV | Downloads quotes CSV | `/api/admin/quotes/export` | Operational | Admin |

### **Links Inside Admin Settings Tab:**

**AdminSettings Component** (`admin-settings.tsx`) contains:

| Link Label | Target Route | Type | Current Location (Dashboard Tab) | Proposed Location (Settings) |
|------------|--------------|------|----------------------------------|------------------------------|
| **Manage Product Types** | `/settings/product-types` | Settings/Config | Dashboard > Settings tab > Products subtab | Settings > Product Catalog |
| **Manage Integrations** (QuickBooks/OAuth) | `/settings/integrations` | Settings/Config | Dashboard > Settings tab | Settings > Accounting & Integrations |

**AdminSettings Tabs Structure:**
- **Products**: Product catalog management + import/export, includes link to Product Types settings
- **Media Library**: Upload/manage images for products
- **Pricing Variables**: Global pricing variables
- **Formula Templates**: Pricing formula templates
- **Email Settings**: Email provider configuration (Gmail OAuth)
- **Workflow**: Job status settings, quote numbering

---

## 4. Settings Navigation Inventory

**Route:** `/settings/*`  
**Layout Component:** `SettingsLayout` (`client/src/pages/settings/SettingsLayout.tsx`)  
**Guard:** Admin/Owner only (enforced by `Guard` component)

### **Settings Navigation Structure:**

| Label | Path | Icon | Description | Implementation Status |
|-------|------|------|-------------|----------------------|
| **Company** | `/settings/company` | Settings | Company info and defaults | Placeholder |
| **Preferences** | `/settings/preferences` | Sliders | Workflow and behavior preferences | **Fully Implemented** (Quote approvals, order validation, inventory reservations) |
| **Users & Roles** | `/settings/users` | Users | User management and permissions | Placeholder |
| **Product Catalog** | `/settings/products` | Package | Products and pricing | Routes to `ProductsPage` |
| **Product Types** | `/settings/product-types` | Tag | Product categories and types | Standalone settings page |
| **Pricing Formulas** | `/settings/pricing-formulas` | DollarSign | Pricing calculation rules | Standalone settings page |
| **Accounting & Integrations** | `/settings/integrations` | PlugZap | QuickBooks and other integrations | Standalone settings page |
| **Production & Operations** | `/settings/production` | Factory | Production workflow settings | **Fully Implemented** (Line Item Status Routing) |
| **Inventory & Procurement** | `/settings/inventory` | Boxes | Inventory and vendor settings | Placeholder |
| **Notifications** | `/settings/notifications` | Bell | Email and notification preferences | Placeholder |
| **Appearance / Themes** | `/settings/appearance` | Palette | UI theme and visual preferences | **Fully Implemented** (Theme picker) |

**Current Routes:**
```
/settings (redirects to /settings/company)
/settings/company
/settings/preferences
/settings/users
/settings/products
/settings/product-types
/settings/pricing-formulas
/settings/integrations
/settings/production
/settings/inventory
/settings/notifications
/settings/appearance
```

---

## 5. Proposed Reorganization Plan

### **A. Dashboard Target Shape (Operational Home)**

**KEEP on Dashboard:**
- ✅ **Calculator** tab (core pricing tool)
- ✅ **Pending Approvals** alert card (operational urgency)
- ✅ **Production** button in header (quick operational jump)
- ✅ **View mode toggle** (Admin/Customer views)

**NAVIGATION REPLACEMENT (tabs → links/cards):**
- Replace tab-based navigation with operational status cards/widgets:
  - **Quick Stats**: Open quotes, pending orders, production jobs count
  - **Recent Activity**: Last 5 quotes/orders with links
  - **Low Stock Alerts**: (already in AdminDashboard, elevate to main Dashboard)
  - **Operational Shortcuts**: Card grid with icons linking to Quotes, Orders, Production, Customers, Contacts

**REMOVE from Dashboard:**
- ❌ **Admin** tab → Move all content to proper homes:
  - System-wide metrics → Keep minimal on Dashboard as cards
  - Procurement links → Move to Settings or main nav (already in sidebar)
  - Quote filtering/export → Move to `/quotes` page or Reports
- ❌ **Settings** tab → This entire mega-component belongs in `/settings/*`
- ❌ **Audit Log** tab → Move to `/settings/audit-logs` or `/admin/audit-logs`
- ❌ **Orders** embedded tab → Remove (redundant with `/orders` in sidebar)
- ❌ **Customers** embedded tab → Remove (redundant with `/customers` in sidebar)

### **B. Settings Reorganization**

**Current Problem:**
- Dashboard > Settings tab contains 6 sub-tabs:
  - Products
  - Media Library
  - Pricing Variables
  - Formula Templates
  - Email Settings
  - Workflow

**Proposed Settings Structure:**

#### **1. Organization** (new/enhanced)
- Company Info (placeholder → implement)
- Global Defaults
- Tax Settings (future)
- Legal/Compliance (future)

#### **2. Users & Access**
- Users & Roles (placeholder → implement)
- Permissions
- Customer Portal Settings (future)

#### **3. Product Catalog & Pricing**
- Products (from Dashboard > Settings > Products)
- Product Types (already exists)
- Pricing Formulas (already exists)
- Pricing Variables (from Dashboard > Settings > Variables)
- Formula Templates (from Dashboard > Settings > Templates)
- Media Library (from Dashboard > Settings > Media)

#### **4. Production & Automation**
- Production Workflow (already exists: Line Item Status Routing)
- Job Status Configuration (from Dashboard > Settings > Workflow)
- Automation Rules (future)

#### **5. Accounting & Integrations**
- QuickBooks Integration (already exists)
- Email Settings (from Dashboard > Settings > Email)
- Other Integrations (future: ShipStation, etc.)

#### **6. System & Preferences**
- Workflow Preferences (already exists)
- Inventory Reservations (already in Preferences)
- Notifications (placeholder)
- Appearance / Themes (already exists)
- Audit Logs (from Dashboard > Audit Log tab)

**Updated Settings Navigation:**

```
Settings (admin/owner only)
├── Organization
│   ├── Company Info
│   └── Defaults
├── Users & Access
│   ├── User Management
│   └── Roles & Permissions
├── Product Catalog & Pricing
│   ├── Products
│   ├── Product Types
│   ├── Pricing Formulas
│   ├── Pricing Variables
│   ├── Formula Templates
│   └── Media Library
├── Production & Automation
│   ├── Line Item Status Routing
│   ├── Job Configuration
│   └── Automation Rules
├── Accounting & Integrations
│   ├── QuickBooks
│   ├── Email Provider
│   └── Shipping Integrations
└── System & Preferences
    ├── Workflow Preferences
    ├── Notifications
    ├── Appearance
    └── Audit Logs
```

### **C. Migration Mapping**

| Current Location | New Location | Notes |
|------------------|--------------|-------|
| Dashboard > Settings tab > Products | Settings > Product Catalog & Pricing > Products | Move entire tab |
| Dashboard > Settings tab > Media Library | Settings > Product Catalog & Pricing > Media Library | Move entire tab |
| Dashboard > Settings tab > Pricing Variables | Settings > Product Catalog & Pricing > Pricing Variables | Move entire tab |
| Dashboard > Settings tab > Formula Templates | Settings > Product Catalog & Pricing > Formula Templates | Move entire tab |
| Dashboard > Settings tab > Email Settings | Settings > Accounting & Integrations > Email Provider | Move entire tab |
| Dashboard > Settings tab > Workflow | Settings > Production & Automation > Job Configuration | Move/merge with Production settings |
| Dashboard > Admin tab | Multiple destinations | Break apart: Metrics → Dashboard cards; Links → Remove (already in nav); Reports → New Reports page |
| Dashboard > Audit Log tab | Settings > System & Preferences > Audit Logs | Move to settings |

---

## 6. Risk Assessment & Mitigation

### **Risks:**

1. **Multi-tenant data leakage**
   - All queries must maintain `organizationId` filtering
   - Risk: Moving components could accidentally bypass `tenantContext` middleware
   - **Mitigation:** Audit all moved components for proper `useAuth()` context usage and API calls with `credentials: include`

2. **Access control bypass**
   - Dashboard Settings tab is inside admin-only view; moving to `/settings` routes uses `Guard` component
   - Risk: Different enforcement mechanism could introduce gaps
   - **Mitigation:** Keep `Guard` component in SettingsLayout; verify all new routes use SettingsLayout parent

3. **State management disruption**
   - Dashboard tabs use React local state; Settings pages use route-based navigation
   - Risk: Moving tab content to routes could break stateful components
   - **Mitigation:** Each tab is already self-contained with TanStack Query for data; minimal refactoring needed

4. **Link rot / broken navigation**
   - Internal links in codebase may point to old Dashboard paths
   - Risk: Moving Settings tab content breaks deep links
   - **Mitigation:** 
     - Search codebase for `<Link href="/settings/...">` patterns
     - Add redirects from old paths (if any external bookmarks exist)
     - Update all hardcoded links in one atomic commit

5. **User workflow disruption**
   - Admins accustomed to Dashboard > Settings tab workflow
   - Risk: Confusion if Settings disappears from Dashboard
   - **Mitigation:**
     - Add prominent "Settings" link in Dashboard header/footer
     - Settings already in main sidebar nav (already exists!)
     - Phase migration: Add "Settings moved" notice to Dashboard Settings tab before removing

6. **Testing coverage gaps**
   - Dashboard has extensive testid attributes; moving components may break tests
   - Risk: E2E tests fail if paths change
   - **Mitigation:** 
     - Search for test files referencing Dashboard tabs
     - Update test paths to new Settings routes
     - Verify all data-testid attributes remain consistent

7. **Drizzle schema lock**
   - No schema changes required (only UI refactoring)
   - Risk: None - this is a UI-only reorganization

8. **Product Builder out of scope**
   - Product management is in scope but Product Builder v2 is not
   - Risk: Accidentally touching Product Builder code
   - **Mitigation:** Only move `AdminSettings` product CRUD tabs; do not modify `ProductEditorPage`

### **What Could Break:**

- Dashboard tabs that navigate internally (Quotes, Contacts, Orders, etc.)
  - **Impact:** Low - these already use `navigate()` calls, not embedded content
- Links to `/settings/integrations` in AdminSettings
  - **Impact:** None - these already route to Settings pages correctly
- Bookmarks to `/#dashboard` with specific tab hash
  - **Impact:** Medium - if users bookmark Dashboard tabs, those will break
  - **Fix:** No hash-based routing currently used; tabs use state only
- TanStack Query cache keys
  - **Impact:** Low - query keys are path-based; moving components doesn't change API routes
- Multi-tenant context in moved components
  - **Impact:** **HIGH** - AdminSettings components must maintain proper auth/tenant context
  - **Fix:** Verify all API calls include `credentials: include` and rely on server-side `tenantContext`

### **Critical Checklist Before Implementation:**

- [ ] Search codebase for all imports of `AdminSettings` component
- [ ] Verify all `/api/*` calls in AdminSettings use `credentials: include`
- [ ] Check for E2E tests referencing Dashboard tabs
- [ ] Review all TanStack Query keys in AdminSettings for multi-tenant safety
- [ ] Confirm Settings > Product Catalog route exists in App.tsx
- [ ] Add Settings link to Dashboard header if not present
- [ ] Document migration in CHANGELOG/release notes
- [ ] Add "Settings moved" deprecation notice to Dashboard Settings tab (temporary)
- [ ] Verify RBAC: all new Settings routes must use SettingsLayout's Guard

---

## Summary

**Dashboard Currently Is:** A **mega-hub** mixing operational tools (Calculator), navigation tabs (Quotes/Orders/Contacts), admin panels (metrics, filtering), and a full settings suite (6 sub-tabs).

**Dashboard Should Be:** An **operational home** with:
- Pricing calculator (core tool)
- Quick action buttons (New Order, Production)
- Operational status cards (pending approvals, low stock, recent activity)
- Minimal navigation shortcuts (link cards to main modules)

**Settings Currently Is:** A well-structured `/settings` area with 11 navigation items, but 6 major functional areas (Products, Media, Variables, Formulas, Email, Workflow) are **hidden inside Dashboard > Settings tab** instead of being in Settings routes.

**Settings Should Be:** The **exclusive home** for all configuration, administration, and system management, organized into logical groups:
1. Organization
2. Users & Access
3. Product Catalog & Pricing (← absorbs Dashboard Settings tabs)
4. Production & Automation
5. Accounting & Integrations (← absorbs Email Settings)
6. System & Preferences (← absorbs Audit Logs)

**Next Steps (Implementation Phase - NOT THIS TASK):**
1. Extract 6 tabs from AdminSettings into standalone Settings pages
2. Add routing in SettingsLayout for new pages
3. Update Settings navigation to new structure
4. Simplify Dashboard to operational-only content
5. Add deprecation notice to Dashboard Settings tab
6. Remove Dashboard Settings tab after migration complete
7. Update all tests and documentation

---

**END OF AUDIT REPORT**
