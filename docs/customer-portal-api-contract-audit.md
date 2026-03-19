# TitanOS Customer Portal API Contract Audit

**Generated**: 2026-03-17  
**Source**: Current dev branch backend code  
**Status**: ✅ EVIDENCE-BASED — No assumptions, no outdated snapshots

---

## Executive Summary

This document audits the **actual deployed TitanOS backend routes** to identify which endpoints are available for a customer-facing portal, which response shapes they return, and which customer portal features are **missing** or require backend changes.

### Key Findings

1. **✅ Existing Portal Routes**: TitanOS has 4 customer-scoped portal endpoints (`/api/portal/*`) with `portalContext` middleware
2. **✅ Auth/Session**: Standard `/api/auth/user` and `/api/me/*` routes work for authenticated users
3. **✅ Invoices/Payments**: Full invoice list/detail/payment/PDF endpoints exist with proper tenant scoping
4. **⚠️ Orders**: Orders list/detail exist but return **all internal fields** (not filtered for customer view)
5. **⚠️ Files/Artwork**: File endpoints exist but are tied to line items; no "customer artwork library" concept
6. **❌ Proofs**: NO customer-facing proof approval workflow exists (prepress is internal-only)
7. **❌ Customer Profile**: NO `/api/customers/me` endpoint; customers table has fields but no self-service API
8. **❌ Saved Addresses**: NO address book endpoints for customers

---

## Architecture Rules (from audit)

### TitanOS Backend Truth

- **Multi-tenant**: All routes require `organizationId` (via `tenantContext` middleware or `portalContext`)
- **Portal auth pattern**: `isAuthenticated` + `portalContext` → resolves `req.portalCustomerId` via `customers.userId` or `customers.email`
- **Session cookies**: Standard Express session (Replit Auth or local password auth)
- **State over status**: Orders use canonical `state` field (`open`, `production_complete`, `closed`, `canceled`), not legacy `status`
- **No customer-facing proof system**: Prepress sessions are staff-only

### What Portal Can/Cannot Do

**✅ Portal CAN:**
- View own quotes/orders/invoices (scoped by `customerId`)
- Convert quote to order (customer approval workflow exists)
- Pay invoices via Stripe
- Download invoice PDFs

**❌ Portal CANNOT (yet):**
- Approve/reject proofs (no proof workflow exists)
- View/manage artwork library (files are tied to line items, not customer-owned)
- Edit own profile/address (no self-service customer API)
- See order production status pills (those are org-staff-only)
- Reorder from past orders (no reorder helper API)

---

## 1. Auth & Session

### 1.1 GET `/api/auth/user`

**Purpose**: Get current authenticated user profile  
**Auth**: `isAuthenticated` (session-based)  
**Tenant scoping**: None (user-level, not org-scoped)

**Request**:
```
GET /api/auth/user
Cookie: connect.sid=<session>
```

**Response** (actual shape from `storage.getUser()`):
```json
{
  "id": "user_uuid",
  "email": "customer@example.com",
  "firstName": "John",
  "lastName": "Doe",
  "profileImageUrl": "https://...",
  "isAdmin": false,
  "isPlatformAdmin": false,
  "role": "employee",
  "mustSetPassword": false,
  "lastLoginAt": "2026-03-17T12:00:00.000Z",
  "lastActiveOrgId": "org_uuid",
  "createdAt": "...",
  "updatedAt": "..."
}
```

**Portal-safe**: ✅ Yes (excludes passwordHash)  
**Notes**:
- Returns user record WITHOUT `passwordHash` (handled by `storage.getUser()`)
- Customer portal users will have `isAdmin: false`, `role: "employee"` (or custom)
- `lastActiveOrgId` is informational only (portal doesn't switch orgs)

### 1.2 GET `/api/me/orgs`

**Purpose**: List all organizations user belongs to  
**Auth**: `isAuthenticated`  
**Tenant scoping**: None (cross-org query)

**Request**:
```
GET /api/me/orgs
```

**Response**:
```json
{
  "success": true,
  "data": {
    "orgs": [
      {
        "id": "org_uuid",
        "name": "Example Print Shop",
        "slug": "example-print",
        "role": "member"
      }
    ],
    "lastActiveOrgId": "org_uuid"
  }
}
```

**Portal-safe**: ⚠️ Partial  
**Notes**:
- Returns ALL orgs user is member of (via `user_organizations` table)
- For portal, customer should only see ONE org (their print shop)
- **Recommendation**: Portal should ignore this endpoint OR filter to single org

### 1.3 POST `/api/me/active-org`

**Purpose**: Switch active organization  
**Auth**: `isAuthenticated`

**Request**:
```json
{ "orgId": "org_uuid" }
```

**Response**:
```json
{
  "success": true,
  "data": { "lastActiveOrgId": "org_uuid" }
}
```

**Portal-safe**: ❌ No  
**Notes**:
- Portal should NOT allow org switching
- Customers are locked to ONE org via `portalContext` middleware

---

## 2. Orders

### 2.1 GET `/api/portal/my-orders`

**Purpose**: List customer's orders  
**Auth**: `isAuthenticated` + `portalContext`  
**Tenant scoping**: Scoped to `req.portalCustomerId`

**Request**:
```
GET /api/portal/my-orders
```

**Response shape** (from `storage.getAllOrders(organizationId, { customerId })`):
```json
{
  "success": true,
  "data": [
    {
      "id": "order_uuid",
      "organizationId": "org_uuid",
      "orderNumber": "10001",
      "poNumber": "PO-12345",
      "label": "Rush signage order",
      "customerId": "customer_uuid",
      "contactId": "contact_uuid",
      "status": "new",  // ⚠️ DEPRECATED field
      "state": "open",  // ✅ Use this (open | production_complete | closed | canceled)
      "statusPillValue": "Awaiting Artwork",
      "paymentStatus": "unpaid",
      "routingTarget": null,
      "billingStatus": "not_ready",
      "priority": "rush",
      "fulfillmentStatus": "pending",
      "dueDate": "2026-03-20T00:00:00.000Z",
      "promisedDate": "2026-03-19T12:00:00.000Z",
      "subtotal": "1250.00",
      "tax": "100.00",
      "total": "1350.00",
      "shippingCents": 0,
      "shippingMethod": "pickup",
      "billToName": "John Doe",
      "billToCompany": "Example Corp",
      "billToAddress1": "123 Main St",
      "billToCity": "Anytown",
      "billToState": "CA",
      "billToPostalCode": "90210",
      "shipToName": "John Doe",
      "shipToAddress1": "123 Main St",
      "shipToCity": "Anytown",
      "shipToState": "CA",
      "shipToPostalCode": "90210",
      "trackingNumber": null,
      "shippedAt": null,
      "productionCompletedAt": null,
      "closedAt": null,
      "notesInternal": "⚠️ INTERNAL ONLY - customer should NOT see this",
      "createdByUserId": "user_uuid",
      "createdAt": "2026-03-17T10:00:00.000Z",
      "updatedAt": "2026-03-17T10:05:00.000Z"
    }
  ]
}
```

**⚠️ PROBLEM: Internal fields exposed**:
- `notesInternal`: Staff-only notes
- `billingStatus`, `billingReadyAt`, `billingReadyOverride`: Internal billing workflow
- `routingTarget`: Internal routing logic
- `statusPillValue`: Org-specific internal status (not customer-facing)
- `createdByUserId`: Internal user tracking

**Portal-safe**: ❌ No (needs filtering)  
**Recommendation**: Create `/api/portal/my-orders` response adapter that excludes:
- `notesInternal`
- `billingStatus`, `billingReadyAt`, `billingReadyPolicy`, `billingReadyOverride*`
- `routingTarget`
- `statusPillValue`, `workflowStatusId`, `canonicalState`
- `createdByUserId`
- Any other `*Internal` fields

### 2.2 GET `/api/orders/:id`

**Purpose**: Get single order detail  
**Auth**: `isAuthenticated` + `tenantContext`  
**Tenant scoping**: ✅ Yes (checks `order.organizationId`)

**Request**:
```
GET /api/orders/:id
```

**Response** (from `storage.getOrder(organizationId, orderId)`):
```json
{
  "success": true,
  "data": {
    // ... same shape as 2.1 (single order object)
    // PLUS line items if populated:
    "lineItems": [
      {
        "id": "line_uuid",
        "orderId": "order_uuid",
        "productId": "product_uuid",
        "productType": "wide_roll",
        "description": "24x36 Coroplast Yard Sign",
        "width": "24.00",
        "height": "36.00",
        "quantity": 100,
        "sqft": "600.00",
        "unitPrice": "12.50",
        "totalPrice": "1250.00",
        "status": "new",
        "workflowState": "new",
        "productionStatus": "not_started",
        "pbv2TreeVersionId": "tree_version_uuid",
        "pbv2SnapshotJson": { /* PBV2 choices snapshot */ },
        "optionSelectionsJson": { /* v2 option selections */ },
        "specsJson": { /* legacy specs */ },
        "notesInternal": "⚠️ INTERNAL",
        "notesProduction": "⚠️ INTERNAL",
        "createdAt": "...",
        "updatedAt": "..."
      }
    ]
  }
}
```

**⚠️ PROBLEM**: Same as 2.1 — exposes internal fields  
**Portal-safe**: ❌ No (needs line-item filtering too)

### 2.3 Missing: Customer-safe state labels

**Problem**: `state: "open"` and `statusPillValue: "Awaiting Artwork"` are internal concepts

**Recommendation**: Portal adapter should map states to customer-friendly labels:
- `open` → "In Progress"
- `production_complete` → "Ready for Pickup/Shipment"
- `closed` → "Completed"
- `canceled` → "Canceled"

Do NOT expose `statusPillValue` (org-specific, changes frequently)

---

## 3. Quotes (Portal-ready)

### 3.1 GET `/api/portal/my-quotes`

**Purpose**: List customer's quotes  
**Auth**: `isAuthenticated` + `portalContext`  
**Tenant scoping**: ✅ Scoped to `customerId`

**Request**:
```
GET /api/portal/my-quotes
```

**Response** (from `storage.getQuotesForCustomer(organizationId, customerId, { source: 'customer_quick_quote' })`):
```json
{
  "success": true,
  "data": [
    {
      "id": "quote_uuid",
      "organizationId": "org_uuid",
      "quoteNumber": "Q-1001",
      "customerId": "customer_uuid",
      "status": "pending",
      "validUntil": "2026-03-30T23:59:59.000Z",
      "subtotal": "1250.00",
      "tax": "100.00",
      "total": "1350.00",
      "notesPublic": "Visible to customer",
      "notesInternal": "⚠️ INTERNAL",
      "lineItems": [ /* ... */ ],
      "createdAt": "...",
      "updatedAt": "..."
    }
  ]
}
```

**Portal-safe**: ⚠️ Partial (has `notesInternal`)  
**Notes**:
- Filtering by `source: 'customer_quick_quote'` suggests quote origin tracking
- `validUntil` should be shown to customer ("Quote valid until...")
- `status` values: `draft`, `pending`, `active`, `canceled` (from schema enum)

### 3.2 POST `/api/portal/convert-quote/:id`

**Purpose**: Customer approves quote and converts to order  
**Auth**: `isAuthenticated` + `portalContext`  
**Tenant scoping**: ✅ Verifies `quote.customerId === portalCustomerId`

**Request**:
```json
{
  "customerNotes": "Please deliver by Friday",
  "priority": "rush",
  "dueDate": "2026-03-20",
  "internalNotes": "..."
}
```

**Response**:
```json
{
  "success": true,
  "data": {
    // Order object (same shape as 2.1)
  }
}
```

**Portal-safe**: ✅ Yes  
**Notes**:
- Sets quote workflow state to `customer_approved`
- Creates audit log with `actionType: 'converted_by_customer'`
- Portal should NOT allow `internalNotes` (filter on frontend)

---

## 4. Invoices & Payments

### 4.1 GET `/api/invoices`

**Purpose**: List invoices  
**Auth**: `isAuthenticated` + `tenantContext`  
**Tenant scoping**: ✅ Yes (`invoices.organizationId`)

**Request**:
```
GET /api/invoices?customerId=customer_uuid&status=billed&limit=50&offset=0
```

**Response** (from direct DB query):
```json
{
  "success": true,
  "data": [
    {
      "id": "invoice_uuid",
      "organizationId": "org_uuid",
      "invoiceNumber": 1001,
      "orderId": "order_uuid",
      "customerId": "customer_uuid",
      "status": "billed",  // draft | billed | paid | void
      "invoiceVersion": 1,
      "lastSentVersion": 1,
      "lastSentAt": "2026-03-17T10:00:00.000Z",
      "lastSentVia": "email",
      "terms": "net_30",
      "issueDate": "2026-03-17T00:00:00.000Z",
      "issuedAt": "2026-03-17T10:00:00.000Z",
      "dueDate": "2026-04-16T00:00:00.000Z",
      "subtotalCents": 125000,
      "taxCents": 10000,
      "shippingCents": 0,
      "totalCents": 135000,
      "currency": "USD",
      "notesPublic": "Thank you for your business",
      "notesInternal": "⚠️ INTERNAL",
      "qbInvoiceId": "QB-123",
      "qbSyncStatus": "synced",
      "modifiedAfterBilling": false,
      "createdAt": "...",
      "updatedAt": "..."
    }
  ]
}
```

**Portal-safe**: ⚠️ Partial  
**Exclude**:
- `notesInternal`
- `qbInvoiceId`, `qbSyncStatus`, `qbLastError` (QuickBooks internal)
- `externalAccountingId`, `syncStatus`, `syncError`
- `modifiedAfterBilling`
- `createdByUserId`

### 4.2 GET `/api/invoices/:id`

**Purpose**: Get invoice detail with relations  
**Auth**: `isAuthenticated` + `tenantContext`  
**Tenant scoping**: ✅ Yes

**Request**:
```
GET /api/invoices/:id
```

**Response** (from `getInvoiceWithRelations(id)`):
```json
{
  "success": true,
  "data": {
    "invoice": {
      // ... same as 4.1
    },
    "customer": {
      "id": "customer_uuid",
      "companyName": "Example Corp",
      "email": "billing@example.com",
      "phone": "555-1234"
    },
    "order": {
      "id": "order_uuid",
      "orderNumber": "10001",
      "poNumber": "PO-12345"
    },
    "lineItems": [
      {
        "id": "line_uuid",
        "invoiceId": "invoice_uuid",
        "productId": "product_uuid",
        "description": "24x36 Coroplast Yard Sign",
        "quantity": 100,
        "unitPriceCents": 1250,
        "lineTotalCents": 125000,
        "sortOrder": 0
      }
    ]
  }
}
```

**Portal-safe**: ✅ Mostly (just filter internal notes/sync fields)

### 4.3 GET `/api/invoices/:id/pdf`

**Purpose**: Download invoice PDF  
**Auth**: `isAuthenticated` + `tenantContext`  
**Tenant scoping**: ✅ Yes

**Request**:
```
GET /api/invoices/:id/pdf?download=1
```

**Response**: Binary PDF with `Content-Type: application/pdf`

**Portal-safe**: ✅ Yes

### 4.4 GET `/api/invoices/:id/payments`

**Purpose**: List payments for invoice  
**Auth**: `isAuthenticated` + `tenantContext`

**Request**:
```
GET /api/invoices/:id/payments
```

**Response**:
```json
{
  "success": true,
  "data": [
    {
      "id": "payment_uuid",
      "invoiceId": "invoice_uuid",
      "provider": "stripe",
      "status": "succeeded",
      "amountCents": 135000,
      "currency": "USD",
      "method": "credit_card",
      "appliedAt": "2026-03-17T10:00:00.000Z",
      "paidAt": "2026-03-17T10:00:00.000Z",
      "stripePaymentIntentId": "pi_abc123",
      "createdBy": {
        "id": "user_uuid",
        "name": "John Doe",
        "email": "john@example.com"
      }
    }
  ]
}
```

**Portal-safe**: ⚠️ Partial  
**Exclude**:
- `stripePaymentIntentId` (internal tracking)
- `metadata`, `syncStatus`, `externalAccountingId`

### 4.5 POST `/api/invoices/:id/payments/stripe/create-intent`

**Purpose**: Create Stripe PaymentIntent for invoice payment  
**Auth**: `isAuthenticated` + `tenantContext`

**Request**: (no body)

**Response**:
```json
{
  "success": true,
  "data": {
    "clientSecret": "pi_abc123_secret_xyz",
    "paymentId": "payment_uuid"
  }
}
```

**Portal-safe**: ✅ Yes  
**Notes**:
- Idempotent (reuses pending payment if exists)
- Returns Stripe client secret for frontend confirmation
- Checks `amountDueCents` from rollup (partial payments handled automatically)

### 4.6 POST `/api/invoices/:id/payments/stripe/confirm`

**Purpose**: Confirm Stripe payment after client-side confirmation  
**Auth**: `isAuthenticated` + `tenantContext`

**Request**:
```json
{
  "paymentIntentId": "pi_abc123"
}
```

**Response**:
```json
{
  "success": true,
  "data": {
    "paymentStatus": "succeeded",
    "updated": true,
    "invoice": { /* updated invoice */ },
    "rollup": {
      "amountPaidCents": 135000,
      "amountDueCents": 0,
      "status": "paid"
    }
  }
}
```

**Portal-safe**: ✅ Yes

### 4.7 POST `/api/invoices/:id/payments/manual`

**Purpose**: Record manual payment (check, cash, etc.)  
**Auth**: `isAuthenticated` + `tenantContext`

**Request**:
```json
{
  "amountCents": 135000,
  "method": "check",
  "appliedAt": "2026-03-17T10:00:00.000Z",
  "notes": "Check #12345",
  "reference": "CHK-12345"
}
```

**Response**:
```json
{
  "success": true,
  "data": {
    "payment": { /* payment record */ },
    "invoice": { /* updated invoice */ },
    "rollup": { /* payment rollup */ }
  }
}
```

**Portal-safe**: ❌ No (staff-only action)  
**Notes**:
- Method must be one of: `check`, `cash`, `wire_transfer`, `ach`, `other` (from `manualPaymentMethodSchema`)
- Portal should use Stripe payments only

---

## 5. Files & Artwork

### 5.1 GET `/api/orders/:orderId/line-items/:lineItemId/files`

**Purpose**: List files for a line item  
**Auth**: `isAuthenticated` + `tenantContext`  
**Tenant scoping**: ✅ Yes (via order check)

**Request**:
```
GET /api/orders/:orderId/line-items/:lineItemId/files
```

**Response**:
```json
{
  "success": true,
  "data": [
    {
      "id": "file_uuid",
      "lineItemId": "line_uuid",
      "storagePath": "org_uuid/orders/order_uuid/...",
      "originalName": "artwork.pdf",
      "mimeType": "application/pdf",
      "size": 1024000,
      "role": "artwork",
      "status": "uploaded",
      "prepressSessionId": null,
      "printType": null,
      "uploadedByUserId": "user_uuid",
      "createdAt": "...",
      "updatedAt": "..."
    }
  ]
}
```

**Portal-safe**: ⚠️ Partial  
**Exclude**:
- `storagePath` (internal storage detail)
- `prepressSessionId` (internal workflow)
- `printType` (prepress internal)
- `uploadedByUserId`

**Notes**:
- `role` enum: `artwork`, `proof`, `reference`, `customer_po`, `setup`, `output`, `other`
- For portal: show only `role: 'artwork'` or `role: 'customer_po'` (customer-uploaded files)

### 5.2 GET `/api/orders/:orderId/line-items/:lineItemId/files/:fileId/download`

**Purpose**: Download file  
**Auth**: `isAuthenticated` + `tenantContext`

**Request**:
```
GET /api/orders/:orderId/line-items/:lineItemId/files/:fileId/download
```

**Response**: Binary file stream with `Content-Disposition: attachment`

**Portal-safe**: ✅ Yes (with customer scope check)  
**Notes**:
- Route checks `order.organizationId` but does NOT check `order.customerId`
- **Security gap**: Portal needs to verify `order.customerId === req.portalCustomerId`

### 5.3 POST `/api/orders/:orderId/line-items/:lineItemId/files`

**Purpose**: Upload file to line item  
**Auth**: `isAuthenticated` + `tenantContext`

**Request**: Multipart form-data with `file` field

**Response**:
```json
{
  "success": true,
  "data": {
    "file": { /* file record */ },
    "message": "File uploaded successfully"
  }
}
```

**Portal-safe**: ⚠️ Needs validation  
**Notes**:
- Portal should allow customers to upload `role: 'artwork'` only
- Portal should restrict upload to orders in `state: 'open'` only (not completed/closed)

### 5.4 ❌ Missing: Customer artwork library

**Problem**: No concept of "customer-owned files" separate from line items

**Current architecture**:
- Files are tied to `orderLineItems` via `line_item_files` table
- No "reusable artwork library" for customers

**Recommendation for portal**:
- Short-term: Show "Past Artwork" by querying all files from customer's past orders
- Long-term: Create `customer_files` table + `/api/portal/artwork` endpoints

---

## 6. Proofs & Production Status

### 6.1 ❌ Missing: Customer-facing proof workflow

**Current prepress system** (INTERNAL ONLY):
- `prepressSessions` table tracks staff prepress work
- `line_item_files` has `role: 'proof'` but no customer approval concept
- Prepress endpoints (`/api/prepress/*`) are all `isAuthenticated` + `tenantContext` (staff-only)

**What does NOT exist**:
- Customer proof approval/rejection API
- Proof notification/email system
- Proof versioning for customer view
- Comments/feedback on proofs

**Recommendation**:
- Create new `proof_approvals` table with fields:
  - `lineItemId`, `proofFileId`, `status` (pending | approved | rejected | revision_requested)
  - `customerUserId`, `customerComments`, `respondedAt`
- Create portal endpoints:
  - `GET /api/portal/proofs` (list pending proofs for customer)
  - `POST /api/portal/proofs/:id/respond` (approve/reject with comments)

### 6.2 ❌ Missing: Customer-safe production status

**Current system**:
- Line items have `workflowState` enum: `new`, `needs_design`, `in_design`, `ready_for_prepress`, `in_prepress`, `ready_for_production`, `in_production`, `completed`, `on_hold`, `canceled`
- These are INTERNAL workflow states, not customer-friendly

**Recommendation**:
- Create portal adapter that maps to customer-friendly labels:
  - `new`, `needs_design`, `in_design`, `ready_for_prepress` → "Processing"
  - `in_prepress`, `ready_for_production`, `in_production` → "In Production"
  - `completed` → "Ready for Pickup/Shipment"
  - `on_hold` → "On Hold" (with reason if available)
  - `canceled` → "Canceled"

---

## 7. Customer Profile & Account

### 7.1 ❌ Missing: `/api/customers/me`

**What exists**: `/api/customers/:id` (admin endpoint)  
**What's missing**: Self-service customer profile endpoint

**Recommendation**: Create `GET /api/portal/me` endpoint:

```json
{
  "success": true,
  "data": {
    "id": "customer_uuid",
    "companyName": "Example Corp",
    "email": "billing@example.com",
    "phone": "555-1234",
    "website": "https://example.com",
    "billingAddress": {
      "street1": "123 Main St",
      "street2": "Suite 100",
      "city": "Anytown",
      "state": "CA",
      "postalCode": "90210",
      "country": "US"
    },
    "shippingAddress": {
      "street1": "123 Main St",
      "city": "Anytown",
      "state": "CA",
      "postalCode": "90210",
      "country": "US"
    },
    "isTaxExempt": false,
    "creditLimit": "5000.00",
    "currentBalance": "1350.00"
  }
}
```

**Exclude from portal response**:
- `pricingTier`, `defaultDiscountPercent`, `defaultMarkupPercent` (internal pricing)
- `productVisibilityMode` (internal)
- `assignedTo`, `userId` (internal)
- `externalAccountingId`, `syncStatus`, `qbFieldOverrides` (QuickBooks)
- `notes` (internal staff notes)

### 7.2 ❌ Missing: Address book endpoints

**What's needed**:
- `GET /api/portal/addresses` (list saved shipping addresses)
- `POST /api/portal/addresses` (add new address)
- `PATCH /api/portal/addresses/:id` (update address)
- `DELETE /api/portal/addresses/:id` (remove address)

**Data model**:
- Create `customer_saved_addresses` table OR
- Use `customerContacts` table (already has address fields)

### 7.3 ❌ Missing: Contact management

**Current**: `customerContacts` table exists with fields:
- `customerId`, `name`, `email`, `phone`, `isPrimary`
- Address fields: `street1`, `city`, `state`, `postalCode`, `country`

**Missing**: Portal API to manage contacts

**Recommendation**: Create endpoints:
- `GET /api/portal/contacts`
- `POST /api/portal/contacts`
- `PATCH /api/portal/contacts/:id`
- `DELETE /api/portal/contacts/:id`

---

## 8. Dashboard & Summary

### 8.1 GET `/api/dashboard/summary`

**Purpose**: Organization-wide dashboard metrics  
**Auth**: `isAuthenticated` + `tenantContext`  
**Tenant scoping**: ✅ Yes

**Request**:
```
GET /api/dashboard/summary
```

**Response** (from `getDashboardSummary(organizationId)`):
```json
{
  "success": true,
  "data": {
    "quotes": {
      "pending": 5,
      "expired": 2,
      "total": 20
    },
    "orders": {
      "open": 10,
      "inProduction": 3,
      "completed": 50
    },
    "invoices": {
      "draft": 2,
      "billed": 8,
      "paid": 30,
      "totalOutstanding": "12500.00"
    },
    "revenue": {
      "thisMonth": "45000.00",
      "lastMonth": "38000.00"
    }
  }
}
```

**Portal-safe**: ❌ No (org-wide metrics, not customer-scoped)

**Recommendation**: Create `GET /api/portal/dashboard` with customer-scoped metrics:
```json
{
  "success": true,
  "data": {
    "quotes": {
      "pending": 2,
      "expired": 0
    },
    "orders": {
      "open": 3,
      "completed": 15
    },
    "invoices": {
      "outstanding": 1,
      "totalDue": "1350.00"
    }
  }
}
```

---

## 9. Products Catalog

### 9.1 GET `/api/portal/products`

**Purpose**: List products visible to customer  
**Auth**: `isAuthenticated` + `portalContext`  
**Tenant scoping**: ✅ Yes

**Request**:
```
GET /api/portal/products
```

**Response** (from `storage.getProductsForPortal(organizationId, customerId)`):
```json
{
  "success": true,
  "data": [
    {
      "id": "product_uuid",
      "name": "Coroplast Yard Signs",
      "sku": "CORO-24x36",
      "description": "Durable outdoor yard signs",
      "basePrice": "12.50",
      "category": "Signage",
      "isActive": true,
      "productType": "wide_roll",
      "thumbnailUrl": "https://..."
    }
  ]
}
```

**Portal-safe**: ✅ Yes (already filtered)

**Notes**:
- Respects customer's `productVisibilityMode`:
  - `default`: All active products
  - `linked-only`: Only products explicitly linked to customer

---

## Confirmed API Shapes (Ready for Portal)

### PortalSession

```typescript
interface PortalSession {
  user: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    profileImageUrl: string | null;
  };
  customer: {
    id: string;
    organizationId: string;
    companyName: string;
    email: string | null;
    phone: string | null;
  };
}
```

**Source**: `GET /api/auth/user` + `portalContext` middleware

---

### PortalOrderListItem

```typescript
interface PortalOrderListItem {
  id: string;
  orderNumber: string;
  poNumber: string | null;
  state: 'open' | 'production_complete' | 'closed' | 'canceled';
  stateLabel: string; // Portal adapter: "In Progress" | "Ready" | "Completed" | "Canceled"
  priority: 'rush' | 'normal' | 'low';
  dueDate: string | null;
  promisedDate: string | null;
  subtotal: string;
  tax: string;
  total: string;
  shippingMethod: 'pickup' | 'ship' | 'deliver' | null;
  trackingNumber: string | null;
  shippedAt: string | null;
  createdAt: string;
}
```

**Source**: `GET /api/portal/my-orders` (filtered)

---

### PortalOrderDetail

```typescript
interface PortalOrderDetail extends PortalOrderListItem {
  billTo: {
    name: string | null;
    company: string | null;
    address1: string | null;
    address2: string | null;
    city: string | null;
    state: string | null;
    postalCode: string | null;
    country: string | null;
    phone: string | null;
  };
  shipTo: {
    name: string | null;
    company: string | null;
    address1: string | null;
    address2: string | null;
    city: string | null;
    state: string | null;
    postalCode: string | null;
    country: string | null;
    phone: string | null;
  };
  lineItems: PortalOrderLineItem[];
}

interface PortalOrderLineItem {
  id: string;
  productType: string;
  description: string;
  width: string | null;
  height: string | null;
  quantity: number;
  sqft: string | null;
  unitPrice: string;
  totalPrice: string;
  workflowStateLabel: string; // Portal adapter: "Processing" | "In Production" | "Ready" | etc.
  files: PortalLineItemFile[];
}

interface PortalLineItemFile {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
  uploadedAt: string;
  downloadUrl: string; // `/api/orders/:orderId/line-items/:lineItemId/files/:fileId/download`
}
```

**Source**: `GET /api/orders/:id` (filtered)

---

### PortalInvoiceListItem

```typescript
interface PortalInvoiceListItem {
  id: string;
  invoiceNumber: number;
  orderId: string | null;
  status: 'draft' | 'billed' | 'paid' | 'void';
  statusLabel: string; // "Draft" | "Unpaid" | "Paid" | "Void"
  issueDate: string;
  dueDate: string | null;
  subtotalCents: number;
  taxCents: number;
  shippingCents: number;
  totalCents: number;
  currency: string;
  amountPaidCents: number;
  amountDueCents: number;
  terms: 'due_on_receipt' | 'net_15' | 'net_30' | 'net_45' | 'custom';
  notesPublic: string | null;
  createdAt: string;
}
```

**Source**: `GET /api/invoices?customerId=...` (filtered)

---

### PortalInvoiceDetail

```typescript
interface PortalInvoiceDetail extends PortalInvoiceListItem {
  lineItems: PortalInvoiceLineItem[];
  payments: PortalPayment[];
  pdfUrl: string; // `/api/invoices/:id/pdf`
}

interface PortalInvoiceLineItem {
  id: string;
  description: string;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
}

interface PortalPayment {
  id: string;
  provider: 'stripe' | 'manual';
  status: 'succeeded' | 'pending' | 'failed' | 'canceled' | 'voided';
  amountCents: number;
  currency: string;
  method: string; // 'credit_card' | 'check' | 'cash' | etc.
  appliedAt: string;
  paidAt: string | null;
}
```

**Source**: `GET /api/invoices/:id` (filtered)

---

### PortalQuoteListItem

```typescript
interface PortalQuoteListItem {
  id: string;
  quoteNumber: string;
  status: 'draft' | 'pending' | 'active' | 'canceled';
  validUntil: string | null;
  subtotal: string;
  tax: string;
  total: string;
  notesPublic: string | null;
  createdAt: string;
}
```

**Source**: `GET /api/portal/my-quotes`

---

### PortalProductListItem

```typescript
interface PortalProductListItem {
  id: string;
  name: string;
  sku: string | null;
  description: string | null;
  basePrice: string;
  category: string | null;
  thumbnailUrl: string | null;
}
```

**Source**: `GET /api/portal/products`

---

## Needs Backend Confirmation

### 1. Order state transitions

**Question**: Can customers transition order states, or is it read-only?  
**Current**: No customer transition endpoints exist  
**Recommendation**: Read-only for portal (state changes driven by staff workflow)

### 2. Line item file upload restrictions

**Question**: Should customers be allowed to upload files after order is `state: 'open'`?  
**Current**: No state validation on file upload  
**Recommendation**: Allow uploads only for `state: 'open'`

### 3. Invoice payment partial amounts

**Question**: Can customers make partial payments via portal?  
**Current**: `/api/invoices/:id/payments/stripe/create-intent` creates intent for **full `amountDueCents`** only  
**Recommendation**: Portal should only support full payment (partial payments handled by staff)

### 4. Quote expiration behavior

**Question**: Can customers accept expired quotes?  
**Current**: `/api/portal/convert-quote/:id` does NOT check `validUntil`  
**Recommendation**: Add validation to reject expired quotes OR auto-extend

---

## Missing for Portal

### Critical (blocking portal launch)

1. **Customer profile API**:
   - `GET /api/portal/me`
   - `PATCH /api/portal/me`

2. **Proof approval workflow**:
   - `GET /api/portal/proofs` (list pending proofs)
   - `POST /api/portal/proofs/:id/respond` (approve/reject)
   - Proof email notifications

3. **Response filtering**:
   - Orders: Remove `notesInternal`, billing fields, internal workflow
   - Invoices: Remove QuickBooks fields
   - Files: Scope to customer's orders only

### Nice-to-have (post-MVP)

1. **Address book**:
   - `GET /api/portal/addresses`
   - `POST /api/portal/addresses`
   - `PATCH /api/portal/addresses/:id`

2. **Artwork library**:
   - `GET /api/portal/artwork` (past files from all orders)
   - Reorder helper using past artwork

3. **Notifications**:
   - Order status change emails
   - Invoice ready emails
   - Proof ready emails

4. **Customer dashboard**:
   - `GET /api/portal/dashboard` (customer-scoped metrics)

---

## Do Not Expose (Internal-Only Concepts)

### Order fields to NEVER expose to portal

- `notesInternal`, `notesProduction`, `notesPrivate`
- `billingStatus`, `billingReadyAt`, `billingReadyPolicy`, `billingReadyOverride*`
- `routingTarget`
- `statusPillValue`, `workflowStatusId`, `canonicalState`
- `createdByUserId`, `assignedTo`
- `externalAccountingId`, `syncStatus`, `syncError`

### Invoice fields to NEVER expose

- `notesInternal`
- `qbInvoiceId`, `qbSyncStatus`, `qbLastError`
- `externalAccountingId`, `syncStatus`, `syncError`
- `modifiedAfterBilling`
- `createdByUserId`

### Customer fields to NEVER expose

- `pricingTier`, `defaultDiscountPercent`, `defaultMarkupPercent`, `defaultMarginPercent`
- `productVisibilityMode`
- `assignedTo`, `notes` (internal staff notes)
- `externalAccountingId`, `syncStatus`, `qbFieldOverrides`

### Line item fields to NEVER expose

- `notesInternal`, `notesProduction`
- `pbv2TreeVersionId`, `pbv2SnapshotJson` (internal pricing/config)
- `productionStatus`, `assignedTo`, `currentStationId`
- `materialRequirements`, `materialOverrides`

---

## Recommended Frontend Adapter Contract

To isolate portal from backend implementation details, create a **frontend adapter layer** that:

1. **Normalizes response shapes**: Maps DB fields → portal-safe DTOs
2. **Filters internal fields**: Strips all `*Internal`, `*Override`, `qb*`, `sync*` fields
3. **Adds computed fields**: `stateLabel`, `statusLabel`, `amountDueCents`, etc.
4. **Handles null/undefined**: Provides sensible defaults for UI
5. **Formats dates**: ISO 8601 strings → localized display

### Example adapter pattern

```typescript
// Backend returns raw DB shape
const rawOrder = await fetch('/api/orders/123').then(r => r.json());

// Frontend adapter transforms to portal-safe DTO
const portalOrder: PortalOrderDetail = adaptOrderForPortal(rawOrder);

function adaptOrderForPortal(raw: any): PortalOrderDetail {
  return {
    id: raw.id,
    orderNumber: raw.orderNumber,
    poNumber: raw.poNumber,
    state: raw.state,
    stateLabel: getStateLabel(raw.state), // "In Progress" | "Ready" | etc.
    priority: raw.priority,
    dueDate: raw.dueDate,
    promisedDate: raw.promisedDate,
    subtotal: raw.subtotal,
    tax: raw.tax,
    total: raw.total,
    shippingMethod: raw.shippingMethod,
    trackingNumber: raw.trackingNumber,
    shippedAt: raw.shippedAt,
    createdAt: raw.createdAt,
    billTo: {
      name: raw.billToName,
      company: raw.billToCompany,
      address1: raw.billToAddress1,
      address2: raw.billToAddress2,
      city: raw.billToCity,
      state: raw.billToState,
      postalCode: raw.billToPostalCode,
      country: raw.billToCountry,
      phone: raw.billToPhone,
    },
    shipTo: {
      name: raw.shipToName,
      company: raw.shipToCompany,
      address1: raw.shipToAddress1,
      address2: raw.shipToAddress2,
      city: raw.shipToCity,
      state: raw.shipToState,
      postalCode: raw.shipToPostalCode,
      country: raw.shipToCountry,
      phone: raw.shipToPhone,
    },
    lineItems: (raw.lineItems || []).map(adaptLineItemForPortal),
  };
}

function getStateLabel(state: string): string {
  const labels: Record<string, string> = {
    open: 'In Progress',
    production_complete: 'Ready for Pickup',
    closed: 'Completed',
    canceled: 'Canceled',
  };
  return labels[state] || state;
}

function adaptLineItemForPortal(raw: any): PortalOrderLineItem {
  return {
    id: raw.id,
    productType: raw.productType,
    description: raw.description,
    width: raw.width,
    height: raw.height,
    quantity: raw.quantity,
    sqft: raw.sqft,
    unitPrice: raw.unitPrice,
    totalPrice: raw.totalPrice,
    workflowStateLabel: getWorkflowStateLabel(raw.workflowState),
    files: (raw.files || []).filter(f => f.role === 'artwork').map(adaptFileForPortal),
  };
}

// ... similar adapters for Invoice, Quote, etc.
```

---

## Appendix: JSON Contract for Lovable

```json
{
  "PortalSession": {
    "user": {
      "id": "string",
      "email": "string",
      "firstName": "string | null",
      "lastName": "string | null",
      "profileImageUrl": "string | null"
    },
    "customer": {
      "id": "string",
      "organizationId": "string",
      "companyName": "string",
      "email": "string | null",
      "phone": "string | null"
    }
  },
  "PortalOrderListItem": {
    "id": "string",
    "orderNumber": "string",
    "poNumber": "string | null",
    "state": "'open' | 'production_complete' | 'closed' | 'canceled'",
    "stateLabel": "string",
    "priority": "'rush' | 'normal' | 'low'",
    "dueDate": "string | null",
    "promisedDate": "string | null",
    "subtotal": "string",
    "tax": "string",
    "total": "string",
    "shippingMethod": "'pickup' | 'ship' | 'deliver' | null",
    "trackingNumber": "string | null",
    "shippedAt": "string | null",
    "createdAt": "string"
  },
  "PortalOrderDetail": {
    "__extends": "PortalOrderListItem",
    "billTo": {
      "name": "string | null",
      "company": "string | null",
      "address1": "string | null",
      "address2": "string | null",
      "city": "string | null",
      "state": "string | null",
      "postalCode": "string | null",
      "country": "string | null",
      "phone": "string | null"
    },
    "shipTo": {
      "name": "string | null",
      "company": "string | null",
      "address1": "string | null",
      "address2": "string | null",
      "city": "string | null",
      "state": "string | null",
      "postalCode": "string | null",
      "country": "string | null",
      "phone": "string | null"
    },
    "lineItems": "PortalOrderLineItem[]"
  },
  "PortalOrderLineItem": {
    "id": "string",
    "productType": "string",
    "description": "string",
    "width": "string | null",
    "height": "string | null",
    "quantity": "number",
    "sqft": "string | null",
    "unitPrice": "string",
    "totalPrice": "string",
    "workflowStateLabel": "string",
    "files": "PortalLineItemFile[]"
  },
  "PortalLineItemFile": {
    "id": "string",
    "originalName": "string",
    "mimeType": "string",
    "size": "number",
    "uploadedAt": "string",
    "downloadUrl": "string"
  },
  "PortalInvoiceListItem": {
    "id": "string",
    "invoiceNumber": "number",
    "orderId": "string | null",
    "status": "'draft' | 'billed' | 'paid' | 'void'",
    "statusLabel": "string",
    "issueDate": "string",
    "dueDate": "string | null",
    "subtotalCents": "number",
    "taxCents": "number",
    "shippingCents": "number",
    "totalCents": "number",
    "currency": "string",
    "amountPaidCents": "number",
    "amountDueCents": "number",
    "terms": "'due_on_receipt' | 'net_15' | 'net_30' | 'net_45' | 'custom'",
    "notesPublic": "string | null",
    "createdAt": "string"
  },
  "PortalInvoiceDetail": {
    "__extends": "PortalInvoiceListItem",
    "lineItems": "PortalInvoiceLineItem[]",
    "payments": "PortalPayment[]",
    "pdfUrl": "string"
  },
  "PortalInvoiceLineItem": {
    "id": "string",
    "description": "string",
    "quantity": "number",
    "unitPriceCents": "number",
    "lineTotalCents": "number"
  },
  "PortalPayment": {
    "id": "string",
    "provider": "'stripe' | 'manual'",
    "status": "'succeeded' | 'pending' | 'failed' | 'canceled' | 'voided'",
    "amountCents": "number",
    "currency": "string",
    "method": "string",
    "appliedAt": "string",
    "paidAt": "string | null"
  },
  "PortalQuoteListItem": {
    "id": "string",
    "quoteNumber": "string",
    "status": "'draft' | 'pending' | 'active' | 'canceled'",
    "validUntil": "string | null",
    "subtotal": "string",
    "tax": "string",
    "total": "string",
    "notesPublic": "string | null",
    "createdAt": "string"
  },
  "PortalProductListItem": {
    "id": "string",
    "name": "string",
    "sku": "string | null",
    "description": "string | null",
    "basePrice": "string",
    "category": "string | null",
    "thumbnailUrl": "string | null"
  },
  "PortalAddress": {
    "id": "string",
    "name": "string | null",
    "company": "string | null",
    "street1": "string",
    "street2": "string | null",
    "city": "string",
    "state": "string",
    "postalCode": "string",
    "country": "string",
    "phone": "string | null",
    "isDefault": "boolean"
  },
  "PortalAccountProfile": {
    "id": "string",
    "companyName": "string",
    "email": "string | null",
    "phone": "string | null",
    "website": "string | null",
    "billingAddress": "PortalAddress",
    "shippingAddress": "PortalAddress",
    "isTaxExempt": "boolean",
    "creditLimit": "string",
    "currentBalance": "string"
  },
  "PortalProofListItem": {
    "__status": "NOT_IMPLEMENTED",
    "id": "string",
    "orderId": "string",
    "lineItemId": "string",
    "proofFileId": "string",
    "status": "'pending' | 'approved' | 'rejected' | 'revision_requested'",
    "proofUrl": "string",
    "submittedAt": "string",
    "dueDate": "string | null"
  },
  "PortalProofDetail": {
    "__status": "NOT_IMPLEMENTED",
    "__extends": "PortalProofListItem",
    "lineItemDescription": "string",
    "customerComments": "string | null",
    "respondedAt": "string | null"
  },
  "PortalArtworkListItem": {
    "__status": "NOT_IMPLEMENTED",
    "id": "string",
    "originalName": "string",
    "mimeType": "string",
    "size": "number",
    "uploadedAt": "string",
    "downloadUrl": "string",
    "usedInOrders": "string[]"
  }
}
```

---

## Summary of Findings

### ✅ Portal-Ready Endpoints (with filtering)

- Auth: `GET /api/auth/user`
- Quotes: `GET /api/portal/my-quotes`, `POST /api/portal/convert-quote/:id`
- Orders: `GET /api/portal/my-orders`, `GET /api/orders/:id`
- Invoices: `GET /api/invoices?customerId=...`, `GET /api/invoices/:id`, `GET /api/invoices/:id/pdf`
- Payments: `POST /api/invoices/:id/payments/stripe/create-intent`, `POST /api/invoices/:id/payments/stripe/confirm`
- Products: `GET /api/portal/products`

### ⚠️ Needs Backend Filtering/Validation

- Orders: Remove internal fields (`notesInternal`, billing workflow, status pills)
- Invoices: Remove QuickBooks/sync fields
- Files: Scope downloads to customer's orders only

### ❌ Missing (Backend Work Required)

- Proof approval workflow (no customer-facing proof API exists)
- Customer profile self-service (`GET /api/portal/me`, `PATCH /api/portal/me`)
- Address book (`GET /api/portal/addresses`, `POST /api/portal/addresses`)
- Artwork library (files are line-item-scoped, not customer-owned)
- Customer dashboard (`GET /api/portal/dashboard` with customer metrics)

### 🚫 Do Not Expose to Portal

- Internal notes/comments (`*Internal`, `*Production`, `*Private`)
- Workflow/routing state (`statusPillValue`, `routingTarget`, `billingStatus`)
- User assignments (`createdByUserId`, `assignedTo`)
- External system IDs (`qbInvoiceId`, `externalAccountingId`, `syncStatus`)

---

**End of Audit**
