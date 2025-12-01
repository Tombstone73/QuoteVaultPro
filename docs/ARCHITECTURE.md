# TitanOS / QuoteVaultPro — System Architecture

> Internal architecture blueprint for TitanOS.  
> Audience: senior devs, Copilot prompts, and future contributors.

---

## 1. High-Level Overview

TitanOS is a multi-tenant, print-focused ERP/CRM platform designed to run an entire print operation:

- CRM (customers, contacts, credit)
- Product catalog + pricing engine
- Quotes & orders
- Jobs & production tracking
- Inventory & materials
- Vendors & purchase orders
- Invoicing & payments
- Fulfillment & shipping
- Customer portal
- Automation (email parsing, file routing, thumbnails, etc.)

Core truth: **everything orbits the order lifecycle**:

> Customer → Product → Quote → Order → Job → Inventory → PO → Invoice → Payment → Shipment → Portal

Many of these modules already have detailed completion docs. 

---

## 2. Tech Stack

**Frontend**

- React + TypeScript
- Vite
- React Query
- shadcn/ui
- Tailwind CSS
- Client-side routing (React Router)

**Backend**

- Node.js + Express
- Drizzle ORM
- PostgreSQL (Neon / Supabase / self-hosted)
- Zod for validation
- JWT-based auth middleware
- Email service abstraction (nodemailer / provider)

**Other**

- Object storage (S3-compatible or provider)
- CI: GitHub Actions (planned)
- External integrations (future): QuickBooks, shipping APIs, etc.

All Copilot prompts must assume this stack unless explicitly overridden.

---

## 3. Multi-Tenancy Model

### 3.1 Tenant Concept

- A **tenant** is a company/group using TitanOS (e.g., Titan Graphics, Creative, CS Kern).
- Multi-tenancy is **hard**-baked into data model and APIs.

### 3.2 `organizationId` Rule

- All core tables MUST include `organizationId`:
  - customers, contacts, quotes, orders, order_line_items, jobs, materials, inventory_adjustments, vendors, purchase_orders, invoices, payments, shipments, etc.
- All queries MUST filter on `organizationId` derived from the authenticated user.
- There should be **no** cross-tenant joins or listings.

### 3.3 Enforcement

- Backend middleware:
  - Extract `organizationId` from JWT/session.
  - Inject `organizationId` when inserting.
  - Require `organizationId` as condition when reading/updating/deleting.
- Frontend:
  - Tenant context loaded once and stored (React context or auth hook).
  - All hooks (`useOrders`, `useQuotes`, etc.) implicitly scoped to current organization.

---

## 4. Auth & RBAC

### 4.1 Roles

- `owner`
- `admin`
- `manager`
- `employee`
- `customer`

### 4.2 Role Rules (High Level)

- Internal users (`owner|admin|manager|employee`) access internal modules.
- Customers only access **portal** endpoints.
- Destructive actions (delete, hard state changes) generally require `admin|owner`.

Each route must define:

1. Required roles  
2. Organization scoping  
3. Whether it's internal or portal-only

---

## 5. Core Domain Modules

> Detailed per-module docs are in `/docs/modules/*`. This section is the **map**, not the full spec.

### 5.1 CRM (Customers, Contacts, Credit)

- Tables: `customers`, `customer_contacts`, `customer_credit_transactions`
- Purpose: single source of truth for customer identity & financial standing.
- Integrates with: Quotes, Orders, Invoices, Portal.

Key rules:

- `customers.userId` or email mapping determines portal account.
- `currentBalance` and `creditLimit` drive AR logic and credit risk.

---

### 5.2 Product Catalog & Pricing Engine

*(This is a logical module; implementation may be spread across product & pricing tables.)*

Responsibilities:

- Define products, variants, options, and pricing formulas.
- Provide a calculation API: `/api/quotes/calculate` etc.
- feed Quotes & Orders.

Future requirement: visual formula builder for pricing (per prior planning).

---

### 5.3 Quotes & Orders

- Tables: `quotes`, `quote_line_items`, `orders`, `order_line_items`.
- Quotes:
  - Built via calculator.
  - Support customer/internal sources.
  - Have workflow states (pending, approved, rejected, etc.).
- Orders:
  - Created directly or from quotes.
  - Central hub for production, inventory, invoicing, and shipping.

Key invariants:

- Converting quote → order snapshots line items.
- Orders must be linked to customer.
- Status transitions must be controlled and logged.

---

### 5.4 Jobs & Production

- Tables: `job_statuses`, `jobs`, `job_status_log`, `job_notes`.
- Purpose: job board, status tracking, assignment, notes.
- Jobs are generally 1:1 with order line items (unless product flags otherwise).

Key behaviors:

- Jobs auto-created when orders (or line items) are created.
- Moving an order to `in_production` triggers inventory deduction and usage logging.
- Status changes must be logged in `job_status_log`.

---

### 5.5 Inventory Management

- Tables: `materials`, `inventory_adjustments`, `order_material_usage`.
- Scope:
  - Materials (sheets, rolls, ink, consumables).
  - Stock quantity, cost, alerts.
  - Usage tracking by order/job.

Rules:

- Every stock change creates an adjustment row.
- `job_usage` and `purchase_receipt` are special, system-driven types.
- Low-stock alerts available via dedicated API route.

---

### 5.6 Vendors & Purchase Orders

- Tables: `vendors`, `purchase_orders`, `purchase_order_line_items`.
- Purpose:
  - Manage procurement.
  - Link POs to materials.
  - Sync vendor costs & material stock when receiving.

Key flow:

- Create PO → send PO → receive items → adjust inventory → update vendorCostPerUnit.

---

### 5.7 Invoicing & Payments

- Tables: `invoices`, `invoice_line_items`, `payments`.
- Purpose:
  - AR lifecycle from order completion to payment.
  - Sync to external accounting (future).

Rules:

- Currently 1 invoice per order.
- Status is derived from payments & due dates.
- Payments must not overpay; refunds/adjustments tracked via transactions.

---

### 5.8 Fulfillment & Shipping

- Tables: `shipments`.
- Purpose:
  - Track shipments.
  - Update order fulfillment status.
  - Generate packing slips & emails.

Rules:

- First shipment moves order to `shipped`.
- `deliveredAt` marks `delivered`.
- Carrier tracking URLs generated based on provider.

---

### 5.9 Customer Portal

- Reuses: quotes, orders, customers, contacts.
- Restricts access via `customer` role.
- Views:
  - My Quotes
  - My Orders
  - Future: My Invoices, My Files, Reorders.

Rules:

- All queries filtered by derived customerId + organizationId.
- Actions (e.g. "accept quote") must be constrained to owned records.

---

## 6. Cross-Cutting Concerns

### 6.1 Global Numbering

- `next_quote_number`
- `next_order_number`
- `next_invoice_number`
- `next_po_number`
- (future) `next_job_number` / `next_shipment_number`

Rules:

- Use transactional updates to avoid collisions.
- Provide helper functions in a shared `numberingService`.

### 6.2 Audit & Activity Logging

- Orders, jobs, credit changes, POs, invoices, etc. should log key events.
- Design principle:
  - "We should be able to reconstruct what happened to any order/job from logs."

### 6.3 Error Handling

- Backend must:
  - Use typed errors where possible.
  - Return consistent `{ error: string }` and HTTP status codes.
- Frontend must:
  - Show meaningful toast/snackbar for failure.
  - Avoid crashing on partial data failures.

---

## 7. Environments & Configuration

- `.env.*` manage:
  - DB connection strings
  - JWT secret
  - Email provider creds
  - Object storage
  - External integrations

Principle: **No environment-specific logic in code**, only in config.

---

## 8. Extension & SaaS Considerations

Preparation for:

- Per-tenant themes (logo, colors, terminology).
- Per-tenant feature toggles.
- Usage/billing metrics.
- Scaling: ability to host multiple orgs comfortably.

Rule: no design choice should make single-tenant → multi-tenant impossible without rewrite.

---

## 9. "Do Not Do This" List

- Do NOT query any core table without `organizationId` constraint.
- Do NOT create portal routes that return internal data.
- Do NOT add random fields to schema without updating:
  - Zod schemas
  - Drizzle definitions
  - API routes
  - Frontend types
- Do NOT let Copilot invent new folders/architectures without explicit instruction.
- Do NOT change API payload shapes silently. Plan migrations.

---
