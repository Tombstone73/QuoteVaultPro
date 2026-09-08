# M7.5J — Proofing operational completion

## Scope and disposition

M7.5J closes the remaining source-level proofing P1: staff can visually review the exact immutable evidence that a customer receives, distinguish current from historical proof versions, and hand a revision request back to canonical Artwork without creating a second proof or file authority. **Disposition: PASS WITH FINDINGS.** No production, provider, or deployment action occurred.

## Authority and lifecycle

`ProofingApplicationService` remains the sole authority for durable Proof Work, ordered immutable Proof Versions, issuance, retry, and the one authoritative response per version. A new version remains legal only after the current one has a revision request; approval remains latest-version-only. Proof Versions retain assignment/file snapshots in `v2_proof_version_artwork`; Artwork continues to own storage, binary delivery, lineage, and replacement. The workboard never mutates this evidence.

## Staff workboard and exact artifacts

The Proofing workboard retains its server-paged/searchable queue and its operational states: needs proof, draft/ready to issue, awaiting customer, delivery action required, revision requested, and approved. It now includes an exact-artifact inspector for the selected version:

- image and PDF evidence render from a private, no-store proof-artifact URL;
- the endpoint verifies the exact `(organization, proofVersion, artworkFile)` binding before asking canonical Artwork storage for bytes;
- current and historical versions are visibly distinct, and history remains selectable;
- the inspector gives bounded Order, Customer, canonical Artwork, and line-Artwork navigation rather than copying any file.

The artifact endpoint requires authenticated `proof.view`; an unbound or cross-tenant file resolves as not found. Portal proof files retain their separate authenticated customer scope and the same immutable binding check.

## Sending, response, and revision

Staff can create a version from current canonical source/reference Artwork, select an eligible customer contact, issue it, and intentionally retry only failed or ambiguous delivery. Email delivery remains a durable queue and is not evidence of approval. Portal and staff responses remain bound to the current issued version; stale, superseded, duplicate, and cross-customer decisions fail closed.

On a revision request, the workboard displays the immutable comment and sends the operator to the canonical line-Artwork workspace. That workspace owns revised source-art adoption and lineage. The operator then creates the next Proof Version from the resulting current assignments. The old version and its artifact remain preserved.

## Downstream and security boundaries

Proofing itself does not advance Routing, Prepress, Production, Fulfillment, or Order state. Routing and Prepress independently evaluate whether the current proof version is approved; a revision request therefore blocks downstream proof-required work. Staff capabilities remain `proof.view`, `proof.prepare`, `proof.issue`, and `proof.respond`; portal scope is derived only from authenticated portal identity. Audit/idempotency reservations continue to cover work, version, issue, retry, and response mutations.

## Validation and remaining findings

- V2 and UI TypeScript checks, import-boundary check, focused UI/static contracts, and diff whitespace checks were run for this source change.
- Focused Jest proof route/read-model/artifact suites ran with `TEST_DATABASE_URL` explicitly blank; no database was contacted or migrated. Database-backed lifecycle rehearsal still requires a separately configured standalone test database.
- No authenticated DEV proof cycle was run, and no Gmail/provider notification was sent. Those are the remaining P1 live-validation findings, along with configured worker/runtime verification.

M7.5J does not alter payments, customer commercial authority, provider configuration, the database schema, historical migrations, or the production application.
