# Customer portal pilot: A1/A2

## Authorization

The existing active, tenant/customer/user-bound portal access record supplies the role. Service checks run before mutation, including Quote approval before canonical conversion.

| Operation | Viewer | Billing | Buyer | Company Admin |
| --- | --- | --- | --- | --- |
| Existing scoped reads / pricing preview | Yes | Yes | Yes | Yes |
| Cart edits / review / place Order | No | No | Yes | Yes |
| Quote response / conversion | No | No | Yes | Yes |
| Proof response / file submission | No | No | Yes | Yes |
| Existing invoice payments | No | Yes | Yes | Yes |
| Company/contact profile update | No | No | No | Yes |

Staff administration retains its existing internal permissions. Signed proof-recipient links and verified guest invoice-payment links retain their existing capability contracts. Staff preview stays read-only except its existing explicitly authorized payment capability.

Authenticated mutation limits use organization + user identity. Pricing previews allow 60 requests/minute, ordinary writes 120/minute, and payments 30/minute. Public proof/payment links fall back to the normalized IP. Invite preview/accept use the existing access-request IP limit. Limits are process-local, consistent with the existing limiter architecture; horizontal scaling will require shared rate-limit storage.

## Commercial terms and release dependency

New linked Invoices resolve customer payment terms at the canonical Order-to-Invoice boundary. Explicit caller terms and existing Invoices remain unchanged. Standard due dates still start at first accounting approval. Custom terms still require staff to supply a due date before approval.

Checkout rechecks current customer commercial fields and canonical tax calculation. Production credit holds remain authoritative; entry/proofing may continue while physical production remains held. No checkout payment, invoice release, accounting approval, or shipping checkout was added.

Migration **0250_portal_order_submitted_follow_up** must apply before checkout. Canonical migration testing found that the existing checkout event `ORDER_SUBMITTED` was absent from the database's follow-up event allowlist. The append-only migration extends that constraint without rewriting history.

## Account pricing eligibility

Online pricing remains unavailable for accounts with a non-default pricing tier or any nonzero default discount, markup, or margin. The session's `accountPricing` identifies the current account's unsupported fields; price errors identify those fields and direct the customer to request a staff Quote. No account-specific adjustment was invented or bypassed.

To enumerate affected pilot accounts, run this **read-only, organization-bound** query with a verified organization ID as `$1`:

```sql
SELECT id, company_name, pricing_tier, default_discount_percent,
       default_markup_percent, default_margin_percent
FROM customers
WHERE organization_id = $1
  AND (COALESCE(pricing_tier, 'default') <> 'default'
       OR COALESCE(default_discount_percent, 0) <> 0
       OR COALESCE(default_markup_percent, 0) <> 0
       OR COALESCE(default_margin_percent, 0) <> 0)
ORDER BY company_name, id;
```

No deployed account inventory or live checkout was accessed in this task. Real affected account names/counts remain a pilot acceptance check.

## Validation evidence

- **85 passing focused server/shared tests.** Service/route coverage: role matrix, actual 403 Quote approval response, guest/staff-preview boundaries, existing payment/proof/file/profile contracts, rate limiting and per-user quota isolation.
- **14 passing PostgreSQL cases**, with all 244 canonical migration hashes/timestamps verified on isolated loopback PostgreSQL: checkout/Invoice/artwork linkage, tax exemption, Net 30 terms and unstarted payment clock, retained production hold, current account-pricing rejection, Quote conversion and duplicate-safe retry, profile persistence/audit, rollback and cart review protection.
- **18 passing frontend tests.** Fixtures: capability-based disabled controls, profile save adapter, file submission permissions, grouped invoice selection, cart review/retry. Frontend persistence is mocked; database evidence comes from the separate PostgreSQL suite.
- Scoped TypeScript checked 26 changed/new TypeScript files using an 8192 MB Node heap: zero introduced diagnostics (18 existing baseline diagnostics). No full-codebase check, live customer checkout, deployment wait, or DEV/MAIN live validation.

## Remaining pilot acceptance

Verify migration application, invited-user role assignment and behavior, eligible account pricing, real file storage/readback, production hold display, and deployed payment/proof access. Existing customer-specific pricing modifiers require staff pricing until canonical support exists. MAIN is outside this release.
