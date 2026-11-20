# Staff direct Order follow-up

The staff `POST /api/orders` route commits the Order, its lines, applicable legacy jobs, and the linked billed Invoice through the existing Orders repository and Billing service. The route waits for the canonical and route-level creation audits and any proof-override audits before starting follow-up.

Follow-up runs only for the request that creates the Order. It synchronizes proof once per saved line, promotes staged artwork by submitted line index with the existing attachment helper, then routes eligible lines when requested or configured. Proof rejection is logged per line. Artwork failures return warnings and later uploads continue. An exception from the routing transaction becomes a structured result on the successful create response.

## Keyed staff requests

A retained receipt scopes the key to the organization, actor, and staff create operation. The Order, billed Invoice, and receipt commit together. A PostgreSQL transaction lock and the receipt primary key serialize competing writers. The receipt stores digests and the saved Order ID. It survives removal of that Order, so a missing result returns a conflict.

An audit or later exception can still interrupt follow-up after commercial commit. A keyed response identifies the saved Order and warns if follow-up failed or remains unverified. On replay, the route reads the current tenant-scoped Order and skips all post-save actions. The receipt records when the synchronous sequence returned without a detected interruption, artwork warning, or blocked or failed routing. Verification of deferred thumbnail work remains separate.

The staff editor recovers uncertain submissions with the original serialized payload and key from the mounted workspace. The recovery action stays available while draft fields are edited. Older requests created before the receipt existed and callers without a key have no durable recovery record. The Storage service's existing cleanup behavior and the saved Order's explicit routing action are independent of this correction.

The isolated HTTP and disposable PostgreSQL suites use the production Order route. The database suite verifies atomic rollback and fresh readback, and starts independent processes against the same synthetic database to verify concurrency and restart behavior. Optional derivatives are stubbed.
