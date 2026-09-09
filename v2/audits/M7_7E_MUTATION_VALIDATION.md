# M7.7E-C — dedicated QA mutation validation

## Scope and safety

All mutations used only the DEV organization `PrintersHero M7 QA` (`b6f969b2-dda3-4133-9d75-c417dabb8f3a`) through its dedicated staff identity. Each mutation was preceded by an authenticated organization check. No ordinary DEV tenant, MAIN, PROD, live Stripe, QuickBooks, Gmail, carrier provider, Railway configuration, or Vercel configuration was mutated.

DEV API health and readiness were successful. The source fixes were successively deployed by Railway: `c8fc6f46`, `26ab3dff`, `97ab9a04`, `e31a3dbc`, and `936e6114`.

## Completed evidence

| Area | Result | Evidence |
| --- | --- | --- |
| Product Builder and routing | PASS WITH FIX | QA-only Flatbed and Roll Products were created, given the minimum enabled canonical runtime option, published, and received immutable active versions plus explicitly authored frozen station destinations. A pre-existing route authoring audit mismatch was fixed in `26ab3dff`. |
| Service-fee projection | PASS WITH FIX | The existing service-fee Order is now projected as Prepress, Production, and Fulfillment not required. `c8fc6f46` excludes service-fee lines from the operational Fulfillment projection. |
| Prepress to Production | PASS WITH FIX | A completed QA Flatbed Prepress unit advanced its frozen Route and created exactly one Production work item; exact retry replayed safely. `97ab9a04` fixes the nullable Product Version lock target. |
| Flatbed | PASS | Two immutable attempts completed a quantity-two QA work item in two quantity-one operations. The final projection was good quantity 2, remaining 0, satisfied true. |
| Roll / double-sided | PASS | The QA Roll fixture created distinct front and back Production work from distinct current Artwork assignments. Each completed its own exact-quantity attempt; both projections reached good quantity 2, remaining 0, satisfied true. |
| Direct Production | PASS WITH FIX | Strict-policy Direct Production set the canonical prepress-not-required exception, advanced only the frozen Flatbed Route, and did not fabricate a Prepress handoff. Explicit Production open then created one Flatbed work item; retry was semantically and byte-for-byte replay-safe. `e31a3dbc` fixes the nullable lock and `936e6114` writes audit changes in the schema-required array shape. |
| Fulfillment and finance | PASS (prior bounded evidence) | The retained fulfillment-only fixture remains the authority for 40 + 35 + 25 quantity allocation, over-allocation rejection, manual shipment metadata, partial manual payment, immutable refund, and durable shipment request replay. |
| Authorization | PASS (bounded) | QA staff mutations were tenant-scoped and CSRF-protected. A foreign-organization bootstrap request was rejected with 403. |
| Portal security / read boundary | PASS (bounded) | Unauthenticated portal reads and mutations returned 401; portal customer scope cannot be supplied by the caller. No active QA portal identity exists, so authenticated portal flows were not exercised. |
| Inbound / AI fail-closed behavior | PASS (bounded) | Inbound review/convert routes have no HTTP ingestion path; no synthetic provider message was fabricated. The DEV AI provider returned 503 for a hostile-prompt turn and created no pending command or mutation. |

## Deliberately unexecuted or blocked

| Area | Classification | Reason |
| --- | --- | --- |
| Proof issue → revision → approval | P1 | Issuing a proof queues a delivery job. Safe DEV worker isolation was not proven, and Gmail/provider sending is outside this run's authorization. No delivery job was enqueued. |
| Authenticated customer Portal flows and IDOR matrix | P1 | The QA tenant has no activated portal identity. The canonical bootstrap path initiates Gmail delivery and was not used. |
| Inbound conversion mutation | P1 | Runtime exposes review/convert controls but no safe HTTP/manual ingest harness for a stable source message. Gmail read is an external authorization task. |
| Live AI reads, PREPARE/GO/CANCEL, permission-removal, injection matrix | P1 | DEV AI provider is unconfigured (503). The hostile prompt caused no mutation, but command execution cannot be claimed. |
| Provider TEST validation | External M8 action | QA has no provider integrations; no Stripe, QuickBooks, Gmail, or carrier call was made. |

## Current disposition

**PARTIAL PASS — M7 remains NO-GO.** The production-work, station, routing, service-fee, shipment, finance, and workflow-exception QA paths are now live-validated and defects found by the run are fixed and revalidated. Provider-dependent Proof, Portal, Inbound, and AI slices remain deliberately unexecuted, so this is not complete M7 cutover evidence.
