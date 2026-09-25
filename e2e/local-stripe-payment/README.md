# Mobile Stripe dialog diagnostics

Run from the repository root in two terminals:

```powershell
node e2e/local-stripe-payment/server.mjs
node e2e/local-stripe-payment/verify.mjs
```

This loopback-only fixture mounts the actual shared payment dialog and diagnostic
client. Stripe, runtime configuration, and intent creation are mocked. Browser
verification blocks non-loopback traffic; it cannot charge cards, access customer
records, or demonstrate Stripe-hosted expiry validation. Use benign fixture text,
never card data. Stop the fixture server when finished.

The automated Chromium checks cover 1280×900, 390×844, 320×568, 390×400,
844×390, and return to portrait, plus grouped checkout at 390×400. They verify
scrolling, reachable Pay, no horizontal overflow, background scroll locking,
one mounted field across resizes, validation blocking confirmation, and safe
lifecycle events in actual local diagnostic request bodies. The small screenshot
is written to the OS temporary directory. WebKit availability is reported
separately; a missing executable is not a passing WebKit test.

## Production evidence

The dialog shows a non-sensitive `Payment reference` UUID. Search backend
application logs for `[STRIPE_PAYMENT_DIAGNOSTIC]` plus that UUID. Check the
server-derived organization/invoice scope. These are diagnostic observations from
a browser, never payment/accounting evidence.

Each event carries sequence, timestamp, viewport dimensions, mount count, and
ready state. Event names: `dialog_open`, `element_mount`, `element_unmount`,
`element_ready`, `element_change`, `element_load_error`, `viewport_change`,
`submit_result`, `confirm_result`, `dialog_success`, `dialog_close`, and
`initialization_error`. Change events include only aggregate `complete`, `empty`,
and `elementType: payment`. Result events include success and optional allowlisted
error code/type plus a fixed canonical message. Unknown error values are replaced
with `unknown`; raw provider messages are never transported. Customer-facing
Stripe validation feedback remains visible in the dialog.

The shared endpoint handler uses existing application logs, not a new database
table. Log access and retention follow the hosting provider's existing policy;
this task does not set or verify that policy. Staff routes require existing invoice
authority, Portal routes existing portal/payment authority, and guest routes a
valid invoice token. Tenant and invoice identity are resolved by the server.

Limits: 20 events per request, 16 KiB maximum accepted request body, 100 events per
dialog, and 30 requests/minute per IP per application instance. Repeated unchanged
completeness/viewport states are suppressed; transitions stop after event 80 to
reserve space for outcomes and close. Delivery is asynchronous, batches after
750 ms, aborts after five seconds, and is not retried. Close flushes with keepalive.
Delivery remains best effort, especially on page termination or a disconnected
phone. There is no diagnostic dependency in payment confirmation.

No card number, expiry, CVC, client secret, raw Stripe event, payment-method
payload, iframe contents, raw user agent, or PaymentIntent identifier is captured.
Existing development-only logs are replaced by the safe shared transport; raw
payment exceptions are no longer printed by this component.

## Physical-device validation still required

Use an authorized Stripe test environment: iPhone Safari, iPhone Firefox,
Bing/in-app context, and desktop Chromium regression. For each iPhone context,
test manual expiry, continuous MMYY digits, slash entry if Stripe accepts it,
blur/refocus, keyboard close/reopen, portrait, and rotation to landscape/back.
Save only the payment reference, safe diagnostic events, and browser/OS category.
Check `complete`, `empty`, submit error code/type, mount count, and viewport size.
Payment Element's completeness is aggregate, not an expiry-only flag.

The clipping fix is locally demonstrated. The original physical-iPhone expiry
failure remains unresolved until the real Stripe-hosted form is tested there.
