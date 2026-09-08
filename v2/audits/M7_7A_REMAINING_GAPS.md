# M7.7A current remaining gaps

## P0 — must close before M8/cutover

1. Reconcile the DEV physical schema through the established pre-Drizzle architecture. Railway proved that normal Drizzle skips current `0270+` migrations because the historical journal is already at its maximum; Orders remains HTTP 500 after `ee284baa` is serving.
2. Establish an isolated safe test database (`TEST_DATABASE_URL` name containing `test`, `testing`, or `ci`) and run the database-backed concurrency/integration suites. The existing guard correctly prevented an unsafe connection.
3. Revalidate integrated authenticated DEV workflows only after that DEV reconciliation attests the current physical schema.
4. Obtain production Vercel ownership, maintenance and rollback proof.
5. Obtain Neon production root-branch/recovery-point/PITR restore authority proof.
6. Perform the fresh cutover-window write-free/Railway writer gate and execute only the separately authorized production reconciliation plan.
7. Complete production QuickBooks OAuth/readiness evidence, including token/key continuity and approved realm/redirect configuration.

## P1 — launch-scope follow-up or explicit acceptance

1. Gmail inbound read-scope re-consent and a controlled DEV ingestion validation.
2. Controlled DEV provider validation for Gmail delivery, storage upload, Stripe TEST checkout/webhook and QuickBooks Sandbox sync.
3. Customer-safe quote/order document contracts, combined-shipment document scope, profile editing and richer portal configuration.
4. Stripe and QuickBooks aggregate-refund provider execution. Current behavior fails closed for multi-allocation provider refunds.
5. Global search/notifications and customer communications/document projections remain intentionally deferred.

## P2 / deferred

- Carrier APIs, broader portal polish and additional AI capabilities are not cutover prerequisites. AI remains bounded to the existing safe capability plane.

No stale M7.5C source-only P0 is retained: Flatbed/Roll, workflow-policy, proofing, Inbound, Portal commerce, payment aggregate, CRM activity and navigation have source/contract evidence. Their remaining work is live/provider proof, not a mandate to rebuild those domains.
