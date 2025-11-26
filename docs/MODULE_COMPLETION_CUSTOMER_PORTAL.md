# TITAN KERNEL Module Completion Document — Customer Portal

## Module Purpose
- Provide external (customer role) users secure access to their quotes and orders, enabling self-service visibility, status tracking, and streamlined quote acceptance & order review.
- Reduce internal workload by exposing key lifecycle data while maintaining strict tenant isolation.

## Data Model Summary
- Reuses internal core tables: `quotes`, `quote_line_items`, `orders`, `order_line_items`, `customers`, `customer_contacts`.
- Portal access derived from mapping of `users` → `customers` via `customers.userId` (preferred) or email matching fallback.
- No portal-specific tables; leverages existing domain entities ensuring single source of truth.
- Key fields surfaced:
  - Quote: number, status (draft, pending_approval, approved, rejected, expired), total, createdAt.
  - Order: orderNumber, status (production workflow), fulfillmentStatus, total, createdAt.
  - Customer: companyName, primary contact info.

## Backend Summary
- **Endpoints (from `server/routes.ts`):**
  - GET `/api/portal/my-quotes` — list quotes for authenticated customer user.
  - GET `/api/portal/my-orders` — list orders for authenticated customer user.
  - POST `/api/portal/quotes/:id/accept` (if implemented) — accept approved or pending quote (conversion logic may call `convertQuoteToOrder`).
  - (Potential) POST `/api/portal/quotes/:id/reject` — register rejection.
- **Authorization Flow:**
  - `requireAuth` ensures session; role check ensures `customer` role.
  - Customer identity resolved; queries constrained by `customerId`.
- **Business Logic:**
  - Quote visibility restricted to customer-owned quotes.
  - Order visibility restricted similarly via `orders.customerId`.
  - On acceptance, quote status transitions → order creation (atomic) preserving line item snapshot.
- **Security Controls:**
  - No arbitrary ID access; queries filter by derived `customerId` regardless of requested path ID.
  - Attempts to access non-owned quote/order yield 404 or 403.

## Frontend Summary
- **Pages:**
  - `client/src/pages/portal/my-orders.tsx` (present) — list view with order statuses.
  - (Expected) `portal/my-quotes.tsx` — similar listing for quotes with statuses & totals.
- **Components/Hooks:**
  - React Query hooks following pattern: `usePortalQuotes`, `usePortalOrders` (to be confirmed/added) with query keys `['portal','quotes']`, `['portal','orders']`.
  - Auth context `useUser()` distinguishes `customer` role and provides gating.
- **UI Features:**
  - Tabular listing with status badges, totals, created date.
  - Quote detail modal for line items & totals; acceptance action button if pending.
  - Order detail showing production & fulfillment statuses.

## Workflows
- **Portal Login:** Customer authenticates; backend resolves associated `customerId`.
- **Quote Review:** User views quote list; selects quote; if status=pending_approval user can accept (triggers backend conversion → order).
- **Order Tracking:** User monitors order statuses, from production through fulfillment/shipping.
- **Security Enforcement:** Every fetch internally filters by `customerId`; no direct global search.

## RBAC Rules
- Role `customer` limited to portal endpoints; cannot access internal `/api/customers` list or modify entities outside acceptance action.
- Acceptance action restricted to quotes in allowed state and belonging to the user’s customer.
- Internal staff roles (`employee+`) do not use portal endpoints (they use internal resources).

## Integration Points
- **Quotes → Orders:** Acceptance uses existing conversion logic (`convertQuoteToOrder`) ensuring order snapshot fidelity.
- **Fulfillment:** Exposes order fulfillmentStatus giving visibility into shipping progress.
- **Invoicing:** (Future) Add invoices visibility & payment initiation.
- **Notifications:** Email service may dispatch confirmation on quote acceptance or order updates.

## Known Gaps / TODOs
- Add invoice & payment visibility (partial payments, outstanding balance).
- Real-time updates via WebSocket or SSE for status changes.
- Document upload (artwork proofs) with approval workflow.
- Quote revision history & change diff view.
- Self-service re-order (clone prior order) & quick quote templating.
- Secure download of packing slips / shipment tracking deep links.

## Test Plan
- Authenticate as customer; fetch `/api/portal/my-quotes` returns only owned quotes.
- Attempt to access someone else’s quote ID via direct path (should 404/403).
- Accept pending quote; verify status changes and new order created referencing original quoteId.
- Fetch `/api/portal/my-orders`; ensure new order appears with correct total & statuses.
- Negative test: Accept already accepted/rejected/expired quote returns proper error.
- Performance: Large set of quotes/orders pagination (if implemented) returns consistent page boundaries.

## Files Referenced
- `server/routes.ts`: portal endpoints.
- `server/storage.ts`: quote/order retrieval & conversion logic.
- `shared/schema.ts`: customers, quotes, orders, line items.
- `client/src/pages/portal/my-orders.tsx` (implemented), expected `portal/my-quotes.tsx`.

## Next Suggested Kernel Phase
- Extend portal with invoices/payments, artwork proofing, and real-time status; implement “quick re-order” and quote revision comparison.
