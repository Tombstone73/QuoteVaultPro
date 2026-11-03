# Assistant PO clarification milestone

Continues `22e3d2645` on `codex/assistant-po-corrections`. The separate
`feat/ai-email-intake` branch is unchanged.

## Behavior

- Shared printing vocabulary supplies both PO extraction and inbound parsing:
  4/4 is full-color front and back; 4/0 is full-color front, blank back.
  Printing context is required; dates and ratios are not print instructions.
- The Assistant maps evidence to the active product's actual option IDs/values.
  Incompatible or ambiguous choices require explicit resolution. A product
  default is not customer evidence. Verified text extraction removes unsupported
  model-supplied print-side claims and restores the source instructions.
- Missing options produce normal-language questions and the existing option
  card. Completing its choices continues the existing proposal/conversation;
  typed answers use the same canonical selection operation.
- Choice requests carry a hash of the complete intake, current product and active catalog tree.
  Updates reload the tenant/user/conversation-bound session under its existing
  row-lock convention and reject changes since the question was prepared.
  Old cards without a version must be refreshed. Pricing and GO revalidation
  remain authoritative; clarification never creates an Order.
- Staff can explicitly resolve a conflicting specification using available
  choices or select another product. Original PO instructions remain attached
  and a staff-resolution warning appears in the final preview.
- Canonical Order creation, exact approved price overrides, tax, reference
  attachments, and deferred production behavior remain unchanged.

## Evidence and limits (2026-10-29)

### Fixture tests

Focused tests cover both notations, missing/defaulted sides, source instructions,
typed and clicked continuation, incompatible configurations, stale choices and
superseded GO proposals. The Brainstorm Print / PO 152918 reproduction retains
Yard Signs, 28 pieces at 24 × 18 inches, 28 versions, double-sided, and exactly
$165 line total through the canonical creation payload and mocked readback.
This is not evidence of the original PO contents or real database persistence.

### Actual DEV inspection

Used the existing dedicated QA fixture with the documented normal browser login,
runtime classification and tenant checks. Business access was read-only.
The accessible DEV catalog contained Coroplast with an active Print Sides node:

- Product: `99758f86-d72a-4f78-b9c3-e2083c361d60`
- Active version: `dbfe162a-9be6-466d-981c-5554d7d3f50d`
- Selection key: `print_sides__import_mpkksm20_ihq24nl`
- Values: `single_sided`, `double_sided`

The updated local resolver mapped 4/0 and 4/4 to these actual catalog values and
kept unspecified sides unresolved. This checks local code against inspected
catalog data; it does not verify the new code in the deployed Assistant.

The accessible catalog had no exact Yard Signs product. Scoped searches found no
matching inbound record, existing Order with exact PO 152918, or QA-owned
conversation matching that PO/customer. The original PO was therefore not
inspected. Coroplast was not substituted for the requested product.

### Database and live verification

No isolated test database was configured. No Order was created or modified,
including the previously entered Brainstorm Print Order. Actual saved-order
readback and competing PostgreSQL clarification updates remain unverified.
No environment variables, mailbox configuration, deployment or remote branches
were changed.

### Static and automated checks

- Scoped TypeScript: 11 changed production files, zero diagnostics (8 GB heap).
- Focused server/shared suites: 64 passed.
- Assistant route suite: 18 passed using local HTTP listeners and mocked services.
- Selected clarification/preview/GO frontend tests: 29 passed.
- Broader inbound suites: 121 passed with the nine baseline failures below.
- Broader frontend suites: 43 passed with the six baseline failures below.
- Broader Operator integration: 35 passed with the one baseline failure below.
- No full repository TypeScript check or build was needed.

### Broader regression limits

Baseline comparison used an ignored Jest transformer to read starting-commit
sources directly from Git without switching, resetting or replacing working
files. It reproduced the same six existing presentation failures, nine inbound
conversion mock failures, and one provider-diagnostic assertion failure.
These unrelated assertions were not weakened. The focused route suite's missing
tenant export and saved-Quote hydration database double were completed so it
can run entirely against mocks.

Use an identified isolated test environment and a dedicated test customer for
the remaining end-to-end GO and fresh persisted-order acceptance. Do not repeat
the real Brainstorm Print Order to validate this milestone.
