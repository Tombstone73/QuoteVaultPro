# M2.1.5 — Proofing UI & API Integration

## Scope and ownership

M2.1.5 wires the M2.1 Proofing domain into the authenticated V2 HTTP runtime and the approved Lovable Proofing composition. It does not change M2.1 persistence, Routing, Artwork ownership, Prepress, Production, or the customer portal.

The reference source remains `reference/lovable-ui`. It is visual and interaction authority, not a runtime dependency and not a source of business state.

## Runtime boundary

`ProofingApplicationService` remains the only coordinator for ProofWork, ProofVersion, and ProofResponse mutations. The new authenticated `/v2/organizations/:organizationId/proofing` router resolves a fresh Principal for every request, applies the established CSRF middleware, preserves the V2 response envelope, and supplies M0 business-request identity to every mutation.

The bounded queue read is `GET /works?limit=1..100`. It is organization-scoped and joins only the owning Order, OrderLine, and current Proofing facts in one PostgreSQL query. `GET /works/:proofWorkId` returns the exact immutable history. Mutations are narrowly scoped to starting work, creating a version from Artwork assignments, issuing, and responding.

The UI uses React Query keys containing session scope and organization. The Proofing workspace uses the existing Artwork-for-Order read to resolve filenames and assignment purpose/side for a selected ProofVersion. It does not copy Artwork metadata into Proofing persistence or create client-side business truth.

## Lovable reconciliation

| Lovable element | V2 owner | M2.1.5 treatment |
| --- | --- | --- |
| Queue, three-rail layout, proof version treatment, status presentation | Visual system / Proofing projections | Adopted with real tenant-scoped ProofWork history. |
| Design/source art and proof version evidence | Artwork + Proofing | Real Artwork assignment/file projection adapter; immutable ProofVersion evidence remains IDs owned by Proofing. |
| Approved / revision requested | Proofing | Real ProofResponse outcome and durable feedback. |
| Preview canvas | Artwork renditions (deferred) | Approved viewer geometry with truthful unavailable treatment; no fake reference art. |
| Send Proof / recipients / resend / viewed facts | Delivery/recipient domain not implemented by M2.1 | Deferred; no fake delivery claim. |
| Simulate Customer Response | Lovable demo; future Portal or truthful staff-recorded-customer operation | Deferred; no staff impersonation. |
| Return to Design / Release to Prepress | Future Prepress and explicit Routing composition | Deferred; proof approval never advances Routing. |

## UI / DOMAIN DECISION REQUIRED

1. **Send Proof, Recipients, Resend, and view tracking.** The reference UI presents a delivery workflow, while M2.1 only records issuance and has no recipient/delivery/view domain. Options: (a) design an explicit issuance-only control and add delivery later (recommended); (b) establish a dedicated delivery-recipient domain; or (c) retain these as read-only/deferred visual slots. Mapping them to issuance now would falsely claim customer delivery.
2. **Simulate Customer Response.** This is reference demo behavior. Options: (a) approve a truthful Staff-recorded-customer response dialog with customer provenance (recommended); (b) wait for Portal response; or (c) omit/defer it. It cannot be wired as a fake customer action.
3. **Return to Design / Release to Prepress.** These actions belong to future Prepress and explicit Routing composition. Options: (a) defer until an owning typed operation exists (recommended); (b) approve a read-only explanatory state; or (c) design the future route-completion interaction. Approval alone must not release or advance work.
4. **Create ProofWork / create next ProofVersion placement.** The operations require a real OrderLine and ordered Artwork assignments, but the approved queue does not specify a selection placement. Options: (a) approve a line-item inspector action (recommended); (b) approve an existing queue-toolbar workflow; or (c) defer visible controls and retain API/test-harness proof. M2.1.5 does not insert a new permanent control.

## Validation

The guarded clone-only Playwright configuration uses only repository-local `playwright.cmd`, `cross-env.cmd`, and `tsx.cmd`; no global `npx` is required. Its host refuses to start without `V2_POSTGRES_INTEGRATION=1` and `TEST_DATABASE_URL` and runs migrations before clone-local ephemeral fixture setup.

The authenticated browser proof creates an Order through real V2 Sales, adopts real Artwork using the existing guarded fixture seam, then invokes the standard Proofing HTTP endpoints with session-bound CSRF. It proves Work creation, V1 issue, durable revision feedback, V2 issue, approval, duplicate replay convergence, stale V1 response rejection, denied mutation, cross-tenant invisibility, immutable history/evidence, Audit and M0 operation results, and unchanged frozen Routing. It also captures the real screen at 1440×900 and compares it to the isolated Lovable reference at the same viewport.

No schema migration was needed or created.
