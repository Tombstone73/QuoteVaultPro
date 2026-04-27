# QuoteVaultPro × Lovable Portal — Integration Audit & Reuse Plan

_Generated: 2026-03-31_

---

## A. Executive Summary

The Lovable draft is a well-structured standalone app that cannot be dropped in as-is — it carries its own `QueryClient`, `AuthContext`, router root, API client, and demo/mock system. All of those **duplicate** systems TitanOS already owns and must be discarded. What remains after stripping the infrastructure layer is genuinely valuable: clean portal-specific types, a safe data-adapter pattern, and richer UI pages for invoices, dashboard, orders, and quotes than TitanOS currently has.

TitanOS already has partial portal infrastructure (routing at `/portal/*`, `usePortal.ts` hooks, proof approval token system). The architecture decision that must happen **before any Lovable code is imported** is: **the existing portal routes live inside `AppLayout` (the staff shell) — they must be moved to a dedicated `PortalLayout` that customers see instead.** That layout shell is the first deliverable.

The Phase 1 proof approval flow is almost entirely server-complete via the token-based `/api/portal/proof/:token` routes in `server/routes/portalProof.routes.ts`. Lovable intentionally left proofs unfinished, so that page must be built fresh against existing TitanOS routes — but the Lovable `PortalLayout` and `PortalSidebar` components are the right shells to adapt first.

---

## B. Green / Yellow / Red Audit by Feature Area

### Infrastructure / App Shell

| File | Rating | Reason |
|---|---|---|
| `src/App.tsx` | 🔴 RED | Standalone app root with its own QueryClient + AuthProvider. TitanOS has `App.tsx`. |
| `src/contexts/AuthContext.tsx` | 🔴 RED | Duplicates TitanOS `useAuth()`. Would create a second auth source of truth. |
| `src/contexts/RuntimeConfigContext.tsx` | 🔴 RED | Demo/mock toggle only. No equivalent concept in TitanOS. |
| `src/components/ProtectedRoute.tsx` | 🔴 RED | TitanOS's `Router()` function in `App.tsx` already gates all routes. |
| `src/lib/api.ts` | 🔴 RED | Duplicates `apiFetch`/`apiRequest`/`queryClient` in `client/src/lib/queryClient.ts` and `client/src/lib/apiConfig.ts`. |
| `src/lib/runtime-config.ts` | 🔴 RED | Mock mode only. Irrelevant in TitanOS. |
| `package.json` | 🔴 RED | Standalone app manifest. Check for any Stripe packages TitanOS doesn't have. |

**States & transitions:** The Lovable auth state machine is `loading → authenticated | unauthenticated`. TitanOS owns an identical machine via `useAuth()` at `client/src/hooks/useAuth.ts`. A second parallel machine would create split auth state with no defined ownership — rejected.

---

### Layout Shell

| File | Rating | Reason |
|---|---|---|
| `src/components/PortalLayout.tsx` | 🟡 YELLOW | Reusable shell, but must strip `DemoBanner`, `DemoPanel`, and `useRuntimeConfig`. Wire logout to TitanOS `useLogout()`. |
| `src/components/PortalSidebar.tsx` | 🟡 YELLOW | Reusable structure + navigation links, but paths must change to TitanOS route constants from `client/src/config/routes.ts`. Remove hardcoded branding. User/customer name must come from `useAuth()`. |

**Critical gap:** Current TitanOS portal routes at `client/src/App.tsx:138-140` are nested inside `<Route element={<AppLayout />}>`. Customers who log in would see the full staff sidebar. The adapted `PortalLayout` must be extracted to a **parallel route tree** that replaces `AppLayout` for all `/portal/*` routes. This is the foundational change before any Lovable page is imported.

**TEMP → PERMANENT:** The `PortalLayout` starts as a new component (`client/src/components/portal/PortalLayout.tsx`) with hard-wired routes. It becomes permanent once all portal pages are verified behind it.

---

### Authentication / Login

| File | Rating | Reason |
|---|---|---|
| `src/pages/portal/Login.tsx` | 🟡 YELLOW | Page structure (email/password form, error handling) is reusable. Must discard all Lovable `useAuth()` calls and `isMockMode` branches. Wire to TitanOS `/api/auth/login` via `apiRequest`. |

**States:** `idle → submitting → authenticated (redirect /portal/dashboard) | error`

**Integration risk:** The portal login page for customer users hits the same `/api/auth/login` endpoint as staff. TitanOS already has a `userId` on the `customers` table linking a customer to a user. Confirm customer users are created with appropriate roles so the session check in `useAuth()` can distinguish customer vs. staff.

**TEMP → PERMANENT boundary:** A customer portal login page is only needed if customers get their own login separate from staff. Phase 1 proof approval is **token-based — no login required**. Defer the portal login page until the proof flow is working.

---

### Proof Approval (Phase 1 — Highest Priority)

| File | Rating | Reason |
|---|---|---|
| _(No Lovable proof page exists)_ | — | Intentionally deferred in Lovable draft. Must be built from scratch. |

**States (server-side, from `shared/proofing.ts`):**

```
proofVersion.status:
  draft → awaiting_response → approved | rejected | revision_requested | superseded

currentApprovalState (from validateProofToken):
  pending → resolved (approve | reject | revision_request)
  pending → overridden (manual_override)
```

**Valid transitions for customer:**
- `pending → approved` via `POST /api/portal/proof/:token/action { action: "approve" }`
- `pending → rejected` via same endpoint `{ action: "reject" }`
- `pending → revision_requested` via same endpoint `{ action: "revision_request" }`
- Already-resolved or overridden tokens → 409 (blocked by server)

**TEMP → PERMANENT:** The token-based proof page at `/portal/proof/:token` is **public** (no session required). It is permanent from day 1 — no auth wall to remove later. The token itself is the auth.

**Integration risk:** `validateProofToken` throws 409 if already resolved. The UI must handle this gracefully and show a "Proof already reviewed" state rather than an error toast.

---

### Dashboard

| File | Rating | Reason |
|---|---|---|
| `src/pages/portal/Dashboard.tsx` | 🟢 GREEN | Clean summary view. Aggregates open orders / pending quotes / unpaid invoices. Reusable with hook remapping. |

**Entities:** Pulls from `useOrders`, `useQuotes`, `useInvoices` — all remapped to TitanOS portal hooks. No state mutation, read-only. Low risk.

**Integration risk:** The dashboard calls all three data sources in parallel. If any portal endpoint isn't yet built, those tiles should show a disabled/empty state rather than throw.

---

### Orders

| File | Rating | Reason |
|---|---|---|
| `src/pages/portal/OrdersList.tsx` | 🟢 GREEN | Rich list with search/filter/date range. Reusable with hook swap. |
| `src/pages/portal/OrderDetail.tsx` | 🟢 GREEN | Line items table, attachments, shipping summary. Reusable with hook swap. Demo security banner must be removed. |
| `src/hooks/useOrders.ts` | 🟡 YELLOW | Rewrite to use TitanOS `apiFetch` against `/api/portal/my-orders`. Discard mock branch. |
| `src/hooks/useOrderDetail.ts` | 🟡 YELLOW | Parallel fetch for order + line items + files is a good pattern. Remap to TitanOS endpoints and adapters. |

**Entities:** Orders, line items, order attachments (artwork + PO).

**States (matches TitanOS order status field):**

```
new → scheduled → in_production → quality_check → ready_for_pickup | shipped → completed
(side exits): on_hold, canceled
```

**TEMP → PERMANENT:** TitanOS `/api/portal/my-orders` already exists in `usePortal.ts`. The current TitanOS `my-orders.tsx` page is a stub card list. The Lovable `OrdersList.tsx` and `OrderDetail.tsx` replace it as the permanent implementation.

**Integration risk:** Lovable's `useOrderDetail.ts` fetches line item workflow state (`LineItemWorkflowState` enum). Confirm the portal endpoint exposes `production_jobs`-routed workflow state safely — staff-internal job IDs and cost data must be stripped by the adapter before the customer sees them.

---

### Quotes

| File | Rating | Reason |
|---|---|---|
| `src/pages/portal/QuotesList.tsx` | 🟢 GREEN | Reusable. Approve button + dialog needs endpoint verification. |
| `src/pages/portal/QuoteDetail.tsx` | 🟢 GREEN | Reusable. Expiration warning logic is portable. |
| `src/hooks/useQuotes.ts` | 🟡 YELLOW | Remap to `/api/portal/my-quotes`. Discard mock. |
| `src/hooks/useQuoteDetail.ts` | 🟡 YELLOW | Derives from list cache — no dedicated detail endpoint. Fine as-is. Verify line items are exposed. |
| `src/hooks/useConvertQuote.ts` | 🟡 YELLOW | Endpoint `/api/portal/convert-quote/:quoteId` already exists. Remap to `apiRequest`. |

**States:**

```
draft → sent → approved → converted_to_order
                ↓
             expired (time-based)
             rejected
```

**TEMP → PERMANENT boundary:** Approval via Lovable posts to an unspecified endpoint. TitanOS's `useConvertPortalQuoteToOrder` in `usePortal.ts` uses `/api/portal/convert-quote/:quoteId`. That is the authoritative endpoint — wire Lovable's UI to it.

**Integration risk:** Lovable's `QuotesList` has an "Approve" button separate from the "Convert to Order" concept. Clarify with business: is quote "approval" = customer accepting the quote (precedes conversion)? Or is it directly convert-to-order? TitanOS's existing hook is `convertPortalQuoteToOrder` — confirm the state transition on the server aligns with what the portal button label says.

**Quote numbers vs. order numbers:** TitanOS architecture explicitly keeps them separate. Lovable respects this (separate `quoteNumber` display). No risk here.

---

### Invoices

| File | Rating | Reason |
|---|---|---|
| `src/pages/portal/InvoicesList.tsx` | 🟢 GREEN | High-value page with Pay Now / View routing. Reusable with hook swap. |
| `src/pages/portal/InvoiceDetail.tsx` | 🟢 GREEN | Highest-value Lovable page. Full Stripe payment form, PDF download, payment history. Reusable with significant hook remapping. |
| `src/hooks/useInvoices.ts` | 🟡 YELLOW | Remap to portal-safe endpoint. Current TitanOS `/api/invoices` is a STAFF route. A portal-safe `/api/portal/invoices` must be built. |
| `src/hooks/useInvoiceDetail.ts` | 🟡 YELLOW | Same — needs portal-safe endpoint. |
| `src/hooks/useStripePayment.ts` | 🟡 YELLOW | `createPaymentIntent` endpoint exists in TitanOS. Remap to `apiRequest`, drop mock mode. |

**Entities:** `invoices` + `invoiceLineItems` + `payments` tables.

**States:**

```
invoice.status: draft → billed → sent → partially_paid → paid | overdue | void

payment.status: pending → succeeded | failed | canceled | refunded | voided
```

**Valid customer transitions:**
- `sent | partially_paid` → initiate Stripe payment → `pending` → `succeeded` → invoice becomes `paid | partially_paid`
- Customer cannot void, cannot mark billed, cannot create manual payments

**TEMP → PERMANENT:** TitanOS's existing `/api/invoices` endpoint is staff-only. Need new `/api/portal/invoices` and `/api/portal/invoices/:id` routes that:
1. Resolve the calling customer from session (`req.user.id → customers.userId → customerId`)
2. Filter by `customerId` only
3. Strip `notesInternal`, QuickBooks sync fields, and any internal-only fields
4. Return only `sent | partially_paid | paid | overdue | void` statuses (not `draft | billed`)

**Integration risk:** The existing TitanOS `InvoiceDetailPage` is a staff view. The Lovable `InvoiceDetail.tsx` is a customer view. They must NOT share endpoints. Two separate route + page trees consuming two separate server endpoints.

---

### Account

| File | Rating | Reason |
|---|---|---|
| `src/pages/portal/Account.tsx` | 🟢 GREEN | Read-only profile display. All edit buttons disabled with "Contact your account manager". Very safe. Remap user data from `useAuth()`. |

**Entities:** `users`, `customers`, `customerContacts`.

**Integration risk:** Lovable's Account page reads from a context that includes customer-specific fields (`customerName`, `role`). TitanOS's `useAuth()` returns a `User` type (staff user model). A portal session needs to carry `customerId` and `customerName` — this requires server-side session enrichment.

---

### Types and Adapters

| File | Rating | Reason |
|---|---|---|
| `src/types/portal.ts` | 🟢 GREEN | Extremely valuable. Clean portal-specific DTOs that enforce the boundary between internal model and customer-visible model. |
| `src/lib/adapters.ts` | 🟢 GREEN | The most architecturally important Lovable file. Transformations from raw API → portal DTOs, stripping internal fields. Must live in TitanOS and be kept in sync with server schema changes. |

**Danger note on adapters:** Adapters currently depend on some mock-specific field assumptions. Before importing, audit each adapter field against actual TitanOS API response shapes. Fields that don't exist in TitanOS responses will silently produce `undefined` — not a crash, but a data gap.

---

## C. Reuse-Worthy Files from Lovable

These files should be copied into TitanOS and adapted:

| Lovable File | Target Path in TitanOS | Adaptation Required |
|---|---|---|
| `src/types/portal.ts` | `client/src/types/portal.ts` | Audit against TitanOS schema; add `proofVersion` types for Phase 1 |
| `src/lib/adapters.ts` | `client/src/lib/portalAdapters.ts` | Remove mock fallbacks; validate each field against actual API response |
| `src/components/PortalLayout.tsx` | `client/src/components/portal/PortalLayout.tsx` | Strip DemoBanner/DemoPanel; wire `useLogout()` from TitanOS |
| `src/components/PortalSidebar.tsx` | `client/src/components/portal/PortalSidebar.tsx` | Remap paths to TitanOS `ROUTES`; wire user/customer name from `useAuth()` |
| `src/pages/portal/Dashboard.tsx` | `client/src/pages/portal/portal-dashboard.tsx` | Remap hooks to TitanOS portal hooks |
| `src/pages/portal/OrdersList.tsx` | `client/src/pages/portal/portal-orders.tsx` | Remap `useOrders` to `useMyOrders` from `usePortal.ts` |
| `src/pages/portal/OrderDetail.tsx` | `client/src/pages/portal/portal-order-detail.tsx` | Remove demo security banner; remap hooks; verify file adapter |
| `src/pages/portal/QuotesList.tsx` | `client/src/pages/portal/portal-quotes.tsx` | Remap hooks; verify approve endpoint |
| `src/pages/portal/QuoteDetail.tsx` | `client/src/pages/portal/portal-quote-detail.tsx` | Remap hooks; expiration logic is portable as-is |
| `src/pages/portal/InvoicesList.tsx` | `client/src/pages/portal/portal-invoices.tsx` | Remap hooks; needs portal-safe invoice endpoint first |
| `src/pages/portal/InvoiceDetail.tsx` | `client/src/pages/portal/portal-invoice-detail.tsx` | Highest effort; Stripe Elements wiring; remap hooks; PDF endpoint |
| `src/pages/portal/Account.tsx` | `client/src/pages/portal/portal-account.tsx` | Remap to `useAuth()` user data; add customerId resolution |
| `src/pages/portal/Login.tsx` | `client/src/pages/portal/portal-login.tsx` | Strip mock mode; wire to `/api/auth/login`; redirect to `/portal/dashboard` |
| `src/hooks/useStripePayment.ts` | `client/src/hooks/portal/usePortalStripePayment.ts` | Remove mock branch; use `apiRequest` |

**Do not port:** `App.tsx`, `AuthContext.tsx`, `RuntimeConfigContext.tsx`, `ProtectedRoute.tsx`, `lib/api.ts`, `lib/runtime-config.ts`, `package.json`.

---

## D. TitanOS Dependency Files Needed for Integration

| TitanOS File | Reason Needed |
|---|---|
| `client/src/App.tsx` | Route tree surgery — extract portal routes from `AppLayout`, add `PortalLayout` tree |
| `client/src/config/routes.ts` | Add portal route constants before building `PortalSidebar` |
| `client/src/hooks/useAuth.ts` | Auth source of truth for portal sessions |
| `client/src/hooks/usePortal.ts` | Existing portal hooks to extend, not replace |
| `client/src/lib/queryClient.ts` | `apiFetch`/`apiRequest` — all Lovable hooks must use this |
| `client/src/lib/apiConfig.ts` | `apiUrl()` / `objectsUrl()` for proper URL resolution |
| `server/routes/portalProof.routes.ts` | Phase 1 proof endpoints (already complete) |
| `shared/proofing.ts` | Proof state types, decision enums for Phase 1 proof viewer |
| `shared/schema.ts` (invoices + payments) | Canonical field names for portal invoice adapters |
| `shared/schema.ts` (customers + contacts) | Fields available for Account page |
| `server/routes/mvpInvoicing.routes.ts` | Staff invoice endpoints to mirror for portal-safe versions |
| `server/routes/auth.routes.ts` | Confirm login endpoint shape for portal-login page |
| `client/src/components/ui/*` | shadcn components — already present, just use them |
| `client/src/hooks/use-toast.ts` | Toast hook — Lovable hooks reference `useToast`, same interface |

---

## E. Recommended Phase 1 Build Order (Proof Approval)

**Goal:** Customer receives email → clicks link → reviews proof → approves/rejects/requests revision → TitanOS canonical state updates with audit trail.

### Step 1 — Portal Route Architecture (no Lovable code yet)

Modify `client/src/App.tsx` to extract portal routes from `AppLayout`:

```tsx
// Before (wrong): portal pages inside staff shell
<Route element={<AppLayout />}>
  <Route path="/portal/my-quotes" element={<MyQuotes />} />
  ...

// After: separate portal tree with its own shell
<Route path="/portal/*" element={<PortalLayout />}>
  ...portal pages...
</Route>

// Plus: public (unauthenticated) proof route
<Route path="/portal/proof/:token" element={<ProofApprovalPage />} />
```

Add portal route constants to `client/src/config/routes.ts`:

```ts
portal: {
  dashboard:   "/portal/dashboard",
  orders:      "/portal/orders",
  orderDetail: (id: string) => `/portal/orders/${id}`,
  quotes:      "/portal/quotes",
  quoteDetail: (id: string) => `/portal/quotes/${id}`,
  invoices:    "/portal/invoices",
  invoiceDetail: (id: string) => `/portal/invoices/${id}`,
  account:     "/portal/account",
  proof:       (token: string) => `/portal/proof/${token}`,
}
```

### Step 2 — Adapt PortalLayout + PortalSidebar from Lovable

Port `PortalLayout.tsx` and `PortalSidebar.tsx` into `client/src/components/portal/`. Strip demo components. Wire `useLogout()` from `useAuth.ts`. Phase 1 sidebar links: Dashboard, Orders, Quotes (Invoices disabled until Phase 2, grayed out).

### Step 3 — Build Proof Approval Page (new, not from Lovable)

Create `client/src/pages/portal/portal-proof.tsx`. This page is **outside the auth guard** — publicly accessible via token only.

**Page states:**

```
loading
  → error (invalid/expired token)
  → already_resolved (409) — "This proof has already been reviewed"
  → pending — show proof viewer + three action buttons
      → submitting
          → resolved — show confirmation with recorded decision
```

**Hooks to write in `client/src/hooks/portal/useProofToken.ts`:**

```ts
export function useProofToken(token: string) {
  return useQuery({
    queryKey: ["/api/portal/proof", token],
    queryFn: () => apiFetch(`/api/portal/proof/${token}`).then(r => r.json()),
    enabled: !!token,
    retry: false,
  });
}

export function useSubmitProofAction(token: string) {
  return useMutation({
    mutationFn: (body: {
      action: "approve" | "reject" | "revision_request";
      comment?: string;
    }) =>
      apiRequest("POST", `/api/portal/proof/${token}/action`, body)
        .then(r => r.json()),
  });
}
```

### Step 4 — Verify Email Link Format

Confirm the email sent by TitanOS includes the correct link format:
`https://{domain}/portal/proof/{token}`

The token resolves via `validateProofToken` in `server/services/proofAccessTokenService.ts`.

### Step 5 — Portal Login Page (defer unless needed for Phase 1 dashboard)

Proof approval is token-based and needs no login. Defer the portal login page until customer-authenticated portal views are required.

---

## F. Recommended Phase 2 Build Order (Invoices + Payments)

### Step 1 — Portal-Safe Invoice Server Routes (new, must be built)

The existing `/api/invoices` requires `isAuthenticated + tenantContext + isAdmin`. Build new routes:

```
GET  /api/portal/invoices          — list by customerId from session
GET  /api/portal/invoices/:id      — detail, verify customerId owns invoice
POST /api/stripe/create-payment-intent   — already exists, verify portal access
POST /api/portal/invoices/:id/confirm-payment  — confirm Stripe payment
```

**Server resolution for `GET /api/portal/invoices`:**
1. `req.user.id` → lookup `customers WHERE userId = req.user.id` → get `customerId`
2. Query `invoices WHERE customerId = ? AND status IN ('sent','partially_paid','paid','overdue','void')`
3. Strip `notesInternal`, QuickBooks fields, `createdByUserId`
4. Return DTO matching `PortalInvoiceListItem` from `types/portal.ts`

**Statuses exposed to customer:** `sent | partially_paid | paid | overdue | void`
**Never expose:** `draft | billed`

### Step 2 — Port Invoice Hooks

Write `client/src/hooks/portal/usePortalInvoices.ts` using `apiFetch` against new portal endpoints. Use Lovable's `useInvoices.ts` and `useInvoiceDetail.ts` as structural reference, stripped of mock mode.

### Step 3 — Port InvoicesList Page

Port `src/pages/portal/InvoicesList.tsx` → `client/src/pages/portal/portal-invoices.tsx`. Swap hooks. Keep Pay Now / View routing logic — it is correct.

### Step 4 — Port InvoiceDetail + Stripe Payment Form

This is the highest-complexity port:
1. Port `src/pages/portal/InvoiceDetail.tsx`
2. Port `src/hooks/useStripePayment.ts` — strip mock mode entirely
3. Verify `@stripe/react-stripe-js` and `@stripe/stripe-js` are in TitanOS `package.json`; install if missing
4. Wire PDF download button to existing invoice PDF endpoint — verify that endpoint exists

**Payment state transitions:**

```
invoice: sent | partially_paid
  → customer initiates payment
  → createPaymentIntent → payment: pending
  → Stripe confirms → payment: succeeded
  → invoice: paid | partially_paid (based on amount vs balance_due)
```

**Do NOT** let the portal write directly to the `payments` table. `confirmPayment` on the server must validate the Stripe payment intent status and then call the same payment recording service that staff uses.

### Step 5 — Staff Manual Payment Note

Staff manual payment logging (cash, check, wire, other) goes through the existing `POST /api/invoices/:invoiceId/payments` route. This is staff-only and needs no portal component. The `payments.method` enum already covers: `cash | check | wire | bank_transfer | credit_card | ach | other`.

### Step 6 — Port Dashboard Page

Port `src/pages/portal/Dashboard.tsx`. By this point all three data hooks (orders, quotes, invoices) will be ready.

### Step 7 — Port Account Page

Port `src/pages/portal/Account.tsx`. Remap profile data from `useAuth()`. Server session must carry `customerId` and `customerName`.

---

## G. Recommended Phase 3 Build Order (Orders, Quotes, Storefront, Artwork, Addresses)

### Orders (enrich existing)

The TitanOS portal already has `/api/portal/my-orders`. Replace stub `my-orders.tsx` with Lovable's richer `OrdersList.tsx` and `OrderDetail.tsx` ports.

1. Verify the portal orders endpoint exposes line item `workflowState` safely (no internal job IDs, no cost data, no operator assignments)
2. Port `OrdersList.tsx` with search + filter
3. Port `OrderDetail.tsx` — remove demo security banner; verify attachment download URLs use TitanOS `objectsUrl()` helper
4. Wire the adapter file filter: only `artwork` and `po` categories visible to customers

**Line item workflow states visible to customers:**

```
pending → in_production → quality_check → ready | shipped | completed
```

Do not expose internal `production_jobs` routing, job priority, cost, or operator assignments.

### Quotes (enrich existing)

1. Portal already has `/api/portal/my-quotes`
2. Port Lovable `QuotesList.tsx` + `QuoteDetail.tsx`
3. Clarify the approve-quote endpoint: is it a separate "customer accept" step, or does it go directly to `convert-quote`? Align UI label with actual server transition.

### Storefront / Products (new build, not from Lovable)

Lovable's Products/Storefront section is disabled. The existing TitanOS endpoint `GET /api/portal/products` exists in `usePortal.ts`. Build portal storefront from scratch using TitanOS's product catalog and the existing product visibility mode (`customers.productVisibilityMode`).

### Artwork Library (new build)

TitanOS has file/attachment routes for order and quote line items. Artwork library for customers means: "show all files I've uploaded to my orders." Build against existing `GET /api/orders/:orderId/files` filtered to `customerId`. Portal should be read-only access.

### Addresses

Customer shipping addresses are in the `customers` table (structured billing/shipping address fields). Add a portal-safe `GET /api/portal/account` endpoint that returns `billingStreet1`/etc. and `shippingStreet1`/etc. The Lovable Account page already has placeholder address sections.

---

## H. Specific Dangers / Anti-Patterns to Avoid

### 1. DO NOT add a second QueryClient

Lovable's `App.tsx` has its own `QueryClientProvider`. If any Lovable file is copied with its `QueryClientProvider` wrapper, it creates a separate query cache that does not share auth state, does not participate in `queryClient.clear()` on logout, and causes stale data leakage. TitanOS's single `queryClient` at `client/src/lib/queryClient.ts` is the only one.

### 2. DO NOT import AuthContext from Lovable

Lovable's `useAuth()` (from `AuthContext.tsx`) and TitanOS's `useAuth()` (from `client/src/hooks/useAuth.ts`) have the same name but different implementations, sources, and session shapes. If both exist in the same bundle, components that import the wrong one will either get undefined user data or hit a different state machine. Delete `AuthContext.tsx` before copying any other Lovable file.

### 3. DO NOT expose staff invoice routes to portal customers

`GET /api/invoices` and `GET /api/invoices/:id` require `isAuthenticated + tenantContext` and return ALL invoices for the org. A customer session hitting that endpoint either gets a 403 or — if their user somehow has org access — sees all customers' invoices. The portal MUST have dedicated `/api/portal/invoices` routes that filter by `customerId`.

### 4. DO NOT let portal pages live inside AppLayout

Current TitanOS portal routes at `client/src/App.tsx:138-140` are nested inside `<Route element={<AppLayout />}>`. Customers who log in see the full staff navigation sidebar, staff-only links, admin settings, etc. This is the first structural fix. The PortalLayout must be a separate route tree.

### 5. DO NOT call hooks inside event handlers

The existing `client/src/pages/portal/quote-checkout.tsx:109` calls `useUploadOrderFile(orderId)` inside `handleSubmit` — this is a React hooks rules violation (hook called conditionally inside a handler). This bug exists in TitanOS today and must be fixed when porting the equivalent Lovable page.

### 6. DO NOT allow adapters to pass through proof internals

The `adapters.ts` from Lovable does not include proof state because proofing was deferred. When `OrderDetail` exposes line items, each line item has a `workflowState`. Do not let the adapter pass through internal proof version IDs, `actorUserId`, internal override reasons, or staff notes. The adapter is the firewall — treat it that way.

### 7. DO NOT create orphaned file uploads

Lovable's `quote-checkout.tsx` uploads files to `/api/objects/upload` and then tries to attach them to the created order. If order creation fails after the upload succeeds, files are orphaned in storage with no parent record. The correct pattern: create the order first, get the `orderId`, then attach files. Files without a parent record should be garbage-collected by the storage layer.

### 8. DO NOT derive customerId from query parameters

Every portal server endpoint must resolve `customerId` from the authenticated session (`req.user.id → customers.userId → customerId`), not from a URL parameter or query string. If a customer can pass `?customerId=...` without server-side ownership verification, cross-customer data leakage is possible.

### 9. DO NOT keep mock mode in any ported file

Mock mode branches (`if (isMockMode()) return mockData`) in Lovable hooks give false confidence during testing and will mask real API failures. Every mock branch must be removed when porting. If a portal endpoint doesn't exist yet, that should produce an explicit error/empty state — not a mock return.

### 10. DO NOT use the Lovable Login page's simulated auth path

Lovable's `Login.tsx` has a `if (isMockMode()) { await simulateLogin(); }` path. That must be completely removed. In TitanOS, `POST /api/auth/login` is the only login mechanism, and the session cookie is the only auth artifact. There is no simulated login acceptable in the production portal.
