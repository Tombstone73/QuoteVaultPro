# Customer Portal Contract

**Status:** Canonical integrated portal contract as of 2026-07-24. This document supersedes older portal planning material that describes draft-only routes, including `/api/portal/convert-quote/:id`, `/api/portal/products`, and customer use of non-portal APIs.

## Boundary and identity

- The only customer application surface is the existing `/portal` shell and `/api/portal/*` backend.
- Customer requests require `isAuthenticated`, `portalContext`, and the portal route's staff-preview mutation guard.
- The server derives the authenticated user, organization, customer, and optional contact from the request. A browser-supplied `customerId` is never an authorization input.
- A portal record must match both the resolved organization and customer. A missing or mismatched context is denied.
- The public token proof route, `/api/portal/proof/:token`, is intentionally separate: token validation establishes its narrow proof/artifact scope. It is not a general portal-session API.

## Supported session API

| Method | Path | Contract |
| --- | --- | --- |
| GET | `/api/portal/me` | Customer-safe session and portal capability DTO. |
| GET/PATCH | `/api/portal/profile` | Scoped profile read/update; login-managed identity fields remain protected. |
| GET | `/api/portal/dashboard` | Customer-safe summary assembled from portal DTO services. |

## Customer records and files

| Area | Read paths | Customer actions |
| --- | --- | --- |
| Invoices | `/invoices`, `/:id`, `/:id/pdf`, `/:id/files`, `/:id/files/:fileId`, `/:id/payments` | Stripe intent creation/confirmation only, when the scoped invoice is payable. |
| Orders | `/orders`, `/:id`, `/:id/files`, `/:id/files/:fileId` | Submit a customer file through `POST /orders/:id/files`. |
| Proofs | `/proofs`, `/:id`, `/:id/file` | Approve, reject, or request revision through the proofing service. |
| Quotes | `/quotes`, `/:id`, `/:id/files`, `/:id/files/:fileId` | Approve, decline, request revision, or submit a customer file through `POST /quotes/:id/files`. |

All file URLs are portal backend routes. A download first verifies record ownership and customer visibility, then the backend obtains or streams the permitted object. Storage keys, buckets, and arbitrary `/objects/*` URLs are not part of the portal contract.

## Customer file submission

- `POST /api/portal/quotes/:id/files` and `POST /api/portal/orders/:id/files` require the same authenticated `portalContext` boundary as every other portal mutation. The server resolves the organization and customer from the session, then verifies that the target quote or order belongs to that customer.
- The first release accepts PDF, JPG, PNG, and TIFF files up to 1 MB. The backend validates the MIME type, matching filename extension, sanitized filename, encoded content, and size before storing through the canonical storage service.
- A submission is stored as a customer-visible `customer_upload` attachment with uploader identity, original filename, entity link, optional customer note, and an audit event. It starts at the durable `pending_review` status; staff can explicitly accept it as a reviewed attachment/reference or reject it with an optional customer-visible note.
- Staff review does not mark final art, complete prepress, approve a proof, create production work, or alter billing/payment state. Order staff may classify an accepted upload as a non-primary artwork reference, never final art.
- Customer submissions are reference files only: they are not linked to a production line item, are never primary artwork, and do not advance quote, order, proof, fulfillment, invoice, or payment state.
- Proof revision requests currently support a scoped note-only workflow. The existing proof model has no safe attachment relationship for a customer upload, so proof-specific uploads are intentionally out of scope until that relationship is designed.
- No malware scanning or quarantine service is implied by this release. Accepted types and size are deliberately conservative; staff must review each submission before using it operationally.

## Workflow and preview rules

- Portal quote actions are `POST /api/portal/quotes/:id/approve`, `.../decline`, and `.../request-revision`. Approval uses the existing quote-to-order conversion service with resolved organization and portal user identity. Decline and revision actions are scoped, serialized, audited, and create idempotent staff follow-up records.
- Portal proof actions are `POST /api/portal/proofs/:id/approve`, `.../reject`, and `.../request-revision`. They use the canonical proofing response service; they do not write proof state from the browser.
- Staff portal preview is read-only. Only `GET` and `HEAD` portal requests are allowed while preview is active.

## Payments

- The portal supports the existing Stripe payment flow only: `POST /api/portal/invoices/:id/payments/stripe/create-intent` and `POST /api/portal/invoices/:id/payments/stripe/confirm`.
- The server scopes the invoice first, retrieves the PaymentIntent from Stripe, validates its organization and invoice metadata, validates the amount, and only then reconciles payment/invoice state. Client-provided success or status fields are not trusted.
- EPS automatic portal settlement is explicitly out of scope until a trusted server-side EPS completion contract provides callback/webhook or transaction lookup, signature verification, correlation, invoice/org/amount/currency checks, retry/idempotency, and audit behavior.

## Explicit exclusions

- No second portal application, separate auth/router/query client, draft API client, or client-side authorization filtering.
- No direct portal database writes, direct object-storage access, MCP dependency, MCP mutation path, or non-portal internal record endpoints.
- No portal product browsing, checkout conversion endpoint, proof-specific upload surface, or automatic EPS settlement in this contract.

## Regression coverage

`server/tests/portalContractBoundary.test.ts` freezes route middleware, request scope, file-download, quote-action, and Stripe confirmation boundaries. Additional portal DTO, file-visibility, proof, staff-preview, frontend-boundary, and Stripe-validation tests remain the detailed coverage suite.
