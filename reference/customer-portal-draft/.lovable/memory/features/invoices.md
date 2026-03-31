Invoice feature endpoints, types, and Stripe payment integration details.

## Confirmed Endpoints
- GET /api/invoices?customerId={id} — list invoices for a customer
- GET /api/invoices/:id — invoice detail with line items
- GET /api/invoices/:id/pdf — download PDF
- GET /api/invoices/:id/payments — payment history
- POST /api/invoices/:id/payments/stripe/create-intent — creates PaymentIntent, returns { clientSecret }
- POST /api/invoices/:id/payments/stripe/confirm — confirms payment with { paymentIntentId }

## Invoice Statuses
- draft → Draft
- billed → Unpaid (payable)
- paid → Paid
- void → Void

## Stripe Integration
- Embedded Stripe Elements (not Checkout redirect)
- Requires VITE_STRIPE_PUBLISHABLE_KEY env var
- In mock_demo mode, payment is simulated without Stripe
- Backend creates PaymentIntent; frontend collects card via Elements; frontend confirms

## Adapter Notes
- Backend responses may include internal fields — adapter strips them
- adaptInvoiceDetail handles nested lineItems and payments arrays
