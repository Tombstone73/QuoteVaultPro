# M2.1.6 — Proofing UX / Domain Decision Closure

## Decision outcome

M2.1.6 adds no schema, workflow state, endpoint, or visible layout change. The existing M2.1 model already has the required Proofing facts. This milestone records the ownership decisions needed to begin M2.2 without making the approved Lovable screen claim facts that V2 does not possess.

## Final ownership boundary

| Fact or operation | Owner | M2.1.6 decision |
| --- | --- | --- |
| ProofWork, ordered immutable ProofVersion, exact Artwork evidence, issuance, approval, revision request, feedback | Proofing | Existing M2.1 ownership remains final. |
| Artwork file identity, storage reference, filename, metadata, usage | Artwork | Proofing references immutable assignment/file evidence; it does not copy or own files. |
| OrderLine commercial work identity and expected product facts | Sales | ProofWork begins only against a legitimate OrderLine. |
| Current route position and explicit step completion | Routing | Proof approval is an input to future composition, never a Routing write. |
| Prepress eligibility, execution, and completion | Future Prepress | Not represented as a Proofing state. |
| Delivery recipient, delivery attempt/result, resend, opened/viewed, bounce | Future Delivery/Communications owner | Not implemented or persisted by Proofing. |

## Issuance versus delivery

`issuedAt` means that a specific immutable ProofVersion is available for a reviewer response. It does **not** mean an email, link, notification, or any other transport successfully reached a recipient.

No V2 Delivery/Communications contract suitable for Proof delivery was found. Existing CRM presentation email reads and legacy/other delivery concerns are not a V2 Proof-delivery owner and must not be reused as such.

The future typed composition seam is intentionally outbound from Proofing:

```text
Proofing: issued ProofVersion identity + organization/work scope
  -> Delivery/Communications: recipient selection and delivery attempt
  -> Delivery/Communications: attempt/result/channel/provider/opened facts
```

Proofing exposes the exact issued Version and immutable evidence. A future delivery operation must accept that typed identity, enforce its own authority and recipient scope, and record delivery facts in its own module. It must not mutate `issuedAt`, manufacture a ProofResponse, or make a resend a new ProofVersion.

### UI / DOMAIN DECISION REQUIRED — Send Proof

The Lovable control promises **Send Proof** and the rail implies recipients, resend, and viewed/opened facts. M2.1 only guarantees issuance. Wiring the control to issuance would falsely imply delivery.

Options:

1. Approve a later Delivery/Communications capability and retain the exact control for that owner. **Recommended.**
2. Approve an explicit visual reframing to an issuance-only action until delivery exists.
3. Keep the visual slot deferred/read-only until Delivery is implemented.

No visible rename or control change was made in M2.1.6.

## Customer-response provenance

The existing `ProofResponse` contract is sufficient:

| Case | `origin` | Principal / attribution | `recordedCustomerId` |
| --- | --- | --- | --- |
| Authenticated Portal customer responds in the future | `direct` | Portal Principal, customer-scoped by AuthorityPolicy | absent |
| Staff records a known customer response received elsewhere | `staff_recorded_customer` | Staff Principal plus real Staff actor attribution | required; must equal the ProofWork customer |
| Staff directly makes a Proofing decision | `direct` | Staff Principal | absent |

The current public surface has no Portal mutation endpoint. The Lovable **Simulate Customer Response** control is reference/demo behavior, not a production workflow. It remains unwired: it must not impersonate a customer or create a fake Portal event.

### UI / DOMAIN DECISION REQUIRED — Customer response control

When approved, a Staff-recorded response must identify the known customer and display truthful Staff-recorded provenance. The Portal flow belongs to a future authenticated portal. The approved screen needs an explicit design decision before either is visibly placed; no simulation button was implemented.

## Release to Prepress

Proofing exposes only this fact: **the current issued ProofVersion has an `approved` ProofResponse**.

Future composition is:

```text
Proof approval + Routing policy/current Proofing step
  -> explicit future Routing/Prepress operation
  -> Prepress eligibility or active Prepress work
```

Routing will own any route-step transition; Prepress will own the resulting work and execution state. M2.1.6 adds no `ready_for_prepress`, `released_to_prepress`, `route_complete`, or `production_ready` field, record, or side effect.

### UI / DOMAIN DECISION REQUIRED — Release to Prepress

The Lovable **Release to Prepress** action is future-domain UI. It remains unwired. It must be implemented only with the future typed Routing/Prepress operation, not as a Proofing approval side effect.

## Status ownership matrix

| Visible/reference status | Classification | Truthful M2.1.6 interpretation |
| --- | --- | --- |
| Draft | Proofing-derived | Work has no current issued Version; no separate mutable state is persisted. |
| Ready to Send | Ambiguous | Could mean ProofVersion prepared/issuable, or delivery-ready; requires the Send decision. |
| Sent | Delivery/Communications | Not represented by `issuedAt`; requires a recorded delivery attempt/result. |
| Viewed / opened | Delivery/Communications | Provider/portal observation fact; not a Proofing outcome. |
| Awaiting Customer | Derived / ambiguous | May be derived only after a real delivery attempt; issuance alone is insufficient. |
| Proof Pending | Proofing-derived when defined carefully | A presentation projection of missing/unissued/current response facts, not persisted status. |
| Approved | Proofing-owned | Current issued Version has `approved` ProofResponse. |
| Revision Requested | Proofing-owned | Current issued Version has `revision_requested` ProofResponse. |
| Superseded | Proofing-derived | Older Version after a later Version exists; not a mutable version status. |
| Revoked | Future correction/delivery domain | No M2.1 revoke semantics; do not present as current business fact. |
| Production Ready | Routing + Prepress / Production projection | Never a Proofing badge or approval synonym. |

## UI PLACEMENT DECISION REQUIRED — start and version creation

The operations are distinct:

1. **Start ProofWork** — operator decides that a legitimate OrderLine requires proofing.
2. **Select Artwork evidence** — operator chooses ordered existing Artwork assignments from that OrderLine.
3. **Create first ProofVersion** — creates immutable proof evidence.
4. **Create next ProofVersion** — available only after current Version has `revision_requested`; selects new or reused Artwork evidence explicitly.

### Approach A — OrderLine Artwork inspector (recommended)

Place a proofing entry action in the existing OrderLine/Artwork inspector, where legitimate work identity and selectable Artwork already exist. The operator selects evidence first, then starts ProofWork and creates V1 atomically from that context. After a revision request, the same line-specific inspector provides “create next version” using the known ProofWork.

- Benefits: preserves OrderLine/Artwork truth, avoids generic queue creation, and supports independent line/page/side work.
- Disadvantages: requires an approved action placement in the Order/Artwork inspector.
- Layout impact: adds an approved action to an existing inspector.
- New visual pattern: no; uses the existing line-action/inspector pattern.

### Approach B — Proofing queue toolbar and guided picker

Add a Proofing queue toolbar action that opens a guided selection of OrderLine and ordered Artwork evidence, then starts work/creates the Version.

- Benefits: centralizes Proofing intake.
- Disadvantages: duplicates selection knowledge already present in the Order/Artwork context and risks a broad search/picker workflow.
- Layout impact: adds a toolbar control and a new dialog/flow.
- New visual pattern: likely yes.

### Approach C — Existing Proofing detail rail after queue selection

Expose creation only after an operator reaches a line-specific Proofing detail context, with an explicit empty-state action for no ProofWork and a later-version action after revision.

- Benefits: keeps all proof operations in the Proofing workstation.
- Disadvantages: a line with no work cannot naturally appear in the queue; requires a second entry path or synthetic queue candidates.
- Layout impact: new empty-state/rail controls.
- New visual pattern: likely yes.

**Recommendation:** approve Approach A. It keeps the business decision adjacent to the real OrderLine and Artwork evidence, while the Proofing workstation remains a queue/review workspace rather than an unconstrained work-creation surface.

## Explicit deferrals

- Customer Portal UI and public response mutation.
- Delivery/Communications subsystem, recipients, channels, resend, provider result, viewed/opened, bounce/failure.
- Proof revocation/correction policy.
- Routing completion operation and all Prepress work/state.
- Preview/rendition processing.
- Any permanent placement or relabeling of the approved Lovable controls.
