# V2 Artwork → Proofing → Prepress → Production Evaluation

Status: isolated PostgreSQL experiment; runtime-proven on the operator-approved disposable clone.

## 1. Executive verdict

**YES, WITH CONTAINED COMPATIBILITY.** V2 can maintain one canonical artwork lifecycle, preserve an existing stored-file identity during production promotion, model genuinely modified production files separately, gate exact quantity allocations and proofs, and atomically hand prepress output to production. The existing schema is usable behind repositories; its missing ownership and recovery semantics are supplied only by V2-private POC metadata.

## 2–4. V1 reconstruction, schema, and clone freshness

Current DEV (`dc47a445`) makes `line_item_artwork → file_records` the intended canonical ordinary-artwork relation. `order_attachments` and `line_item_files` are compatibility/workflow projections; final production files remain useful handoff records but are not a second V2 domain source. Proof state lives in `line_item_proof_versions`, approvals, tokens, and package members. Prepress sessions have no final-art foreign key; V1 finalization can leak a global DB write outside its route transaction (ARCH-015). V1 also commits proof state before fire-and-forget email (ARCH-022), and attachment deletion can leave canonical artwork current (ARCH-010).

The clone contained all required current table/column/index structures for file records, canonical artwork, attachment/final-file projections, proofing, prepress, and production. It initially lacked current DEV migration `0150_retired_final_production_files.sql`; the exact current enum migration was applied only to this disposable clone and fresh-read verified. No connection data is recorded here.

## 5–8. V2 artwork, lifecycle, storage, and modified copies

`PostgresArtworkProofingPrepressApplication` owns explicit application operations, with separate authorization, request/idempotency, canonical artwork, projection, proof/delivery, and prepress/handoff responsibilities. Domain results expose canonical artwork identity and file identity—not attachment or storage implementation details.

`attachArtwork` creates a test-owned `file_records` identity and a current `customer_source` relationship, then writes the required attachment projection in one transaction. The deterministic test adapter creates only database references; it does not write an object store. `useForProduction` creates a current `production` relationship using the **same** `file_record_id`, so role transition never duplicates bytes. `createModifiedProductionArtwork` creates a distinct test file record and `modified_production` relationship, preserves `parent_artwork_id`/supersession history, and never overwrites the source.

## 9. Quantity allocation

Readiness is calculated from current canonical relationships only. Allocation quantities are summed by `allocation_group_id`, so front/back members of one group count once; each group must agree internally and the group total must exactly equal line quantity. Attach rejects an allocation that would exceed line quantity before it creates any file/artwork/projection. The runtime suite proves 4+6 for a quantity-10 line is ready, while 4+5 is rejected as unresolved.

## 10–11. Proofing and delivery recovery

V2 creates immutable proof versions and assignment membership, sends only a draft proof, creates a hashed response token, clears prior approval, and atomically creates `v2_poc_proof_deliveries(PENDING)`. New proof creation supersedes actionable earlier proofs and revokes their tokens, preventing a stale response from regressing approval. Delivery reconciliation is independent from proof business state: an injected failure leaves `awaiting_response` truthful and a durable pending record; a fresh instance completes it without another proof version. The raw response token is never persisted in V2 idempotency JSON. Approval/rejection/revision require the scoped, unexpired token and lock the line.

## 12–14. Prepress, handoff, retirement

Prepress start and finalization enforce proof approval when required. Finalization locks the line/session, validates production allocations, writes a final-file projection for every canonical assignment, creates a production job and V2-private `READY` handoff snapshot containing the full assignment set, and completes the session in one transaction. Injecting failure after final-art persistence leaves no handoff or partial final file. Production resolves only `{order/line, jobId, assignment artwork/file identities, group/quantity/side, readiness}` from the handoff table.

Retirement locks the line, records immutable V2 retirement history, supersedes the canonical artwork and descendants, marks every matching active final projection `retired`, withdraws matching ready handoffs, and cancels their queued jobs in the same transaction. Fresh reads no longer resolve retired artwork for proofing, prepress, or production.

Return-to-prepress withdraws the ready handoff, cancels its queued job, retires active final projections, and creates a new active session without deleting customer artwork, proof history, or prior handoff history. This POC deliberately does not implement every V1 irreversible/run recovery edge case.

## 15–19. Concurrency, failures, tenant isolation, compatibility, future runs

The V2-private line revision row and `FOR UPDATE` line lock make promotion/modification/retirement deterministic: concurrent promotion with one expected revision yields one success and one stale-write rejection. Durable request rows replay completed attach/promotion/modified/proof/finalize commands and reject altered same-key payloads. Failure tests cover canonical/projection writes, delivery reconciliation, and final-art-to-handoff boundaries.

Every query binds organization plus related order/line identity. Runtime tests reject cross-tenant attach and V2 reads; proof token lookup is organization and line scoped. The suite conditionally reads a suitable V1 canonical artwork record without mutation; current records translate cleanly when their canonical allocation data exists. Legacy attachment/file projections remain repository translation, never V2 domain input.

Combined runs remain a future fit: a run can reference one shared nested/final `line_item_files` record while each V2 handoff/member retains its own canonical artwork/file identity, group/quantity/side snapshot, and return-to-prepress history. Full nesting and run orchestration are intentionally not implemented.

## 20. Compatibility scorecard

| Module / Repository | Existing Tables Used | Translation | Runtime Result | Rating | Concern |
| --- | --- | --- | --- | --- | --- |
| Artwork | line_item_artwork, file_records | canonical relation + attachment mirror | attach/promotion/retire proven | GREEN | schema has no retired canonical enum |
| File/Storage Mapping | file_records, attachment/final projections | deterministic V2 test reference | identity reuse and modified identity proven | YELLOW | object-store writes intentionally out of scope |
| Proofing | versions, approvals, tokens, package members | V2 token/delivery boundary | approval/revision gate proven | GREEN | actual email provider not exercised |
| Prepress | sessions, line_item_files | atomic final projection/session/handoff | rollback and return proven | GREEN | run-specific recovery remains future work |
| Production Handoff | jobs, final file projection | V2 private ready snapshot | fresh read contract proven | GREEN | no combined-run nesting implementation |
| Notification/Reconciliation | V2 private deliveries | durable pending/completed state | failure/fresh retry proven | GREEN | no worker lease/backoff yet |
| Idempotency | V2 private request table/state | request hash + result | replay/conflict/fresh instances proven | GREEN | proof-token first-delivery handling needs production UX policy |

## 21–23. Complexity and hazards

Added V2 code: 1 application module, 5 PostgreSQL repository responsibilities, 8 canonical operations, 5 V2-private durable tables, 1 SQL artifact, and 1 integration suite. Existing tables touched are canonical art/file, attachment/final-file projections, proof, session, and job tables. Physical duplication is avoided for existing-file promotion and required only for a modified file identity. **No V1 business service or repository is reused; no direct V1 route/service mutation exists.**

V1 has canonical relationships plus route-owned side/allocation/delete writers and post-commit proof email; prepress final-art has a porous transaction. V2 adds explicit private metadata and translation code, but gives one mutation owner, one proof owner, one atomic prepress boundary, durable delivery recovery, scoped read contracts, and lock/revision concurrency. New complexity is consciously isolated: a future worker lease/backoff, object-store adapter, and full run recovery remain required before promotion.

## 24–25. Full-rebuild recommendation and next experiment

1. One canonical artwork source: **yes**. 2. Existing files reused without copying: **yes**. 3. Modified files preserve source/history: **yes**. 4. Multi-design allocation is unambiguous: **yes**. 5. Proof state/delivery recover independently: **yes**. 6. Retirement prevents future V2 use: **yes**. 7. Prepress finalizes atomically to readiness: **yes**. 8. Return-to-prepress is clean for the reversible case: **yes**. 9. Existing PostgreSQL remains behind adapters: **yes, contained**. 10. V1 services/repositories necessary: **no**. 11. Easier to reason about: **yes, due to explicit ownership and durable boundaries, not line count alone**.

The parallel-rebuild thesis is now **MUCH STRONGER**. The highest remaining uncertainty is **Payments → Refunds → Invoice Correction**, where financial state, provider reconciliation, and reversals have not yet had the same isolated durability proof.

## Validation

- V2 PostgreSQL harness: 4 suites / 26 tests passed.
- New artwork/proof/prepress suite: 5 integration tests passed, covering core lifecycle, modified-copy/stale write, allocation/retirement, tenant/V1-read compatibility, stale proof revocation, and ready-handoff withdrawal.
- Focused safe V1 artwork/proof/prepress contracts: 8 suites / 55 tests passed without a database URL.
- `git diff --check` passed.
