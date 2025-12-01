# TITAN KERNEL Module Completion Document — CRM (Customers, Contacts, Notes, Credit)

## Module Purpose
- Maintain customer master data, contacts, internal notes, and credit accounting (balance & limit) to support quoting, ordering, and financial workflows.
- Provide a unified source of truth for customer relationships and financial standing.

## Data Model Summary
- **Tables (core excerpt):**
  - `customers`: id, companyName, email, phone, website?, primaryAddress fields, `creditLimit`, `currentBalance`, lifecycle timestamps, linkage fields (`userId` for portal association), status/flags (if present), timestamps.
  - `customer_contacts`: id, `customerId`, firstName, lastName, email, phone, role/title?, isPrimary?, timestamps.
  - `customer_notes` (append-only internal notes – if present) OR integrated into audit (implementation tracks notes via routes).
  - `customer_credit_transactions`: id, `customerId`, amount (+/-), type (adjustment, payment_application, refund, charge), reason, createdByUserId, createdAt.
- **Relationships:**
  - `customer_contacts.customerId -> customers.id` (CASCADE).
  - `customer_credit_transactions.customerId -> customers.id` (CASCADE).
- **Financial Fields:**
  - `creditLimit`: max authorized credit exposure.
  - `currentBalance`: running balance after transactions (updated atomically).
- **Enums/Types:**
  - Credit transaction `type` values (adjustment, charge, payment, refund) per schema.

## Backend Summary
- **Schemas:** Defined in `shared/schema.ts` with Zod insert/update schemas: `insertCustomerContactSchema`, credit transaction schema, and customer fields including credit metrics.
- **Storage/Services:** `server/storage.ts` (customer-related methods; inferred from routes):
  - Customers: list, getById, create, update, delete.
  - Contacts: list by customer, create, update, delete.
  - Notes: list/create (simple text entries) – stored in dedicated table or integrated (routes expose `/api/customers/:customerId/notes`).
  - Credit: list transactions, create transaction, apply credit adjusting `currentBalance`.
- **Business Rules:**
  - Deletion of customers restricted (only if safe; RBAC gating).
  - Credit application updates balance and logs a transaction row with type + reason.
  - Contacts cascade on customer deletion.
  - Portal linkage via either `customers.userId` or fallback by matching email.

## API Summary (from `server/routes.ts`)
- **Customers:**
  - GET `/api/customers` (list, internal users)
  - GET `/api/customers/:id` detail
  - POST `/api/customers` create
  - PATCH `/api/customers/:id` update
  - DELETE `/api/customers/:id` (admin only)
- **Contacts:**
  - GET `/api/customers/:customerId/contacts`
  - POST `/api/customers/:customerId/contacts`
  - (PATCH/DELETE contact endpoints follow standard pattern if implemented)
- **Notes:**
  - GET `/api/customers/:customerId/notes`
  - POST `/api/customers/:customerId/notes` append
- **Credit:**
  - GET `/api/customers/:customerId/credit-transactions`
  - POST `/api/customers/:customerId/credit-transactions` create raw transaction
  - PATCH `/api/customer-credit-transactions/:id` update (admin)
  - POST `/api/customers/:customerId/apply-credit` apply credit (adjust limit/balance or record financial event)
- **Validation:** Zod schemas for contacts, credit transactions, and customer updates; numeric coercion for amounts.
- **Responses:** `{ success: true, data }` or `{ message|error }` with 4xx for validation / 404 for missing records.

## Frontend Summary
- **Pages:**
  - Customers list (not shown here but present in codebase), customer detail page with contacts and notes.
  - Contact detail (`client/src/pages/contact-detail.tsx`).
- **Components:** Forms for customer and contact creation/edit (pattern: React Hook Form + Zod).
- **Hooks:** `useAuth` for role gating; (customer-specific hooks assumed following pattern like `useCustomers`, `useCustomerContacts`).
- **Interactions:** Add/update customer data; manage contacts; append notes; apply credit adjustments.

## Workflows
- **Customer Creation:** Staff enters basic info + credit limit; system initializes `currentBalance=0`.
- **Add Contacts:** Staff adds contact records; used for quote/order association.
- **Record Notes:** Append-only internal context during lifecycle (sales, service events).
- **Apply Credit:** Admin applies credit transaction (charge, payment, adjustment) updating balance and log.
- **Portal Linkage:** User’s account matched to a customer for portal views (direct `userId` or email fallback).

## RBAC Rules
- Auth required for all customer operations.
- Create/update/delete restricted to internal staff; delete restricted to `admin|owner`.
- Credit application limited to `admin|owner`; notes creation allowed for broader staff (manager+).
- Customers (role `customer`) can only see their own data via portal endpoints (not full customer listing).

## Integration Points
- **Quotes & Orders:** Customers and contacts referenced on quotes/orders; portal uses association for filtering.
- **Invoicing:** Customer linkage for invoices; credit balance informs AR decisions.
- **Portal:** Customer quick quotes rely on ensuring a customer record for the user.
- **Audit:** Important operations can be logged via audit log utilities (create/update/delete actions).

## Known Gaps / TODOs
- Advanced CRM features: tagging, segmentation, activity timeline, SLA tracking.
- Credit risk scoring and automated limit adjustments.
- Bulk import/export with validation preview.
- Contact roles/permissions and primary contact enforcement.
- Customer merge & dedupe tooling.

## Test Plan
- Create customer; verify fields and default `currentBalance=0`.
- Add contact; confirm contact appears under customer.
- Append note; verify retrieval order (newest first if implemented).
- Apply credit transaction (positive and negative); verify `currentBalance` recalculated and transaction logged.
- Delete customer as admin; verify cascade removal of contacts (or restriction if dependent records exist).
- Portal user retrieval of their own orders/quotes via customer linkage (customer cannot list others).

## Files Added/Modified (Representative)
- `shared/schema.ts`: customers, customerContacts, customerCreditTransactions definitions & schemas.
- `server/routes.ts`: customer, contacts, notes, credit endpoints.
- `server/storage.ts`: customer/contact/credit logic and balance recalculations.
- Frontend pages & forms: customers list/detail, `contact-detail.tsx`.

## Next Suggested Kernel Phase
- Implement richer CRM dashboard with pipeline metrics, activity timeline, and automated credit risk alerts; introduce data quality and dedupe utilities.
