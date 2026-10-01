# P1 Reusable Invoice Tax Evidence Contract Freeze

Baseline: `406d3af21f849332da0b1118d1f4c4f0b4022fcf`.
Scope: the billable-replacement evidence handoff, including the existing Billing
shipping consumer. This repair contract does not replace the authoritative
`V2_MODULE_OWNERSHIP_BOUNDARIES.md` or change tax/issuance policy.

## 1. Canonical Read Contract

Billing exposes one versioned reusable-evidence result: resolved frozen basis,
unresolved basis with one existing supported reason, or explicitly not reusable.
Resolved basis retains jurisdiction identity, receipt location, rate and exemption.
Unresolved reasons remain exactly `tax_jurisdiction_not_configured` and
`tax_jurisdiction_conflict`. Unavailable is not resolved, exempt, or zero-rated.
The result identifies its Invoice, organization and financial synchronization
version, and distinguishes native evidence from compatibility interpretation.

## 2. Owner And Source

Billing owns normalization and reuse. Both existing Billing operations consume
the same reader: `createOrReadReplacementInvoice` and
`applyShippingChargeInTransaction`. Fulfillment/Shipping retain their existing
owner calls and receive no new tax parser, calculator or financial writer.
The source remains the current canonical Billing Invoice financial revision,
read consistently on the supplied client. It is not today's Order, Product,
Customer, Settings, or a substitution of issuance-time financial semantics.

## 3. Normalization Boundary

Normalize before Billing reuse, without updating the source row. Preserve the
existing draft calculator, amounts, raw storage representations and issue
eligibility: canonical unresolved evidence still blocks issuance; the existing
recognized compatibility branch does not become newly blocked or newly resolved.
No producer-wide rewrite or commercial-charge math repair is included.
Newly created issued checkpoints may additionally capture the normalized result
and its provenance at issuance; their fingerprint includes that new snapshot.
This is an additive future checkpoint field, not normalization of old checkpoints.
An optional current reusable-evidence projection on the existing Invoice read
is permitted for visibility; it is labeled current revision, not historical fact.

Implementation disposition: this package uses the current read/reuse projection
only. The optional future checkpoint addition is not selected. Producer writers,
issuer implementation, eligibility and checkpoint persistence remain unchanged.

## 4. Historical Compatibility Eligibility

Canonical raw evidence takes precedence and retains the existing consumers'
minimum reusable-basis rules. Invalid canonical evidence must not fall back to
the companion. Compatibility requires all of the following, not tax zero alone:

- Exact `zero_tax_compatibility` kind and
  `v2-billing-zero-tax-compatibility-v1` envelope/scalar versions.
- Coherent optional context-reference presence/value; no unsupported envelope.
- The same Invoice's persisted `sales_tax_composition` explicitly and validly
  records a supported unresolved reason and the known composition version.
- Safe amounts, zero stored tax, coherent subtotal/adjustment/total and companion
  final total; no retained charge or commercial-charge ambiguity.
- Correct tenant, Invoice, Order and currency binding and a valid financial
  synchronization version, compared losslessly.
- For an already issued compatibility Invoice, its immutable issued checkpoint
  identifies that same Invoice/version and agrees with context and financial
  facts. A changed or missing issuance version binding fails closed for this
  newly supported compatibility path. Draft/issuance capture uses the currently
  locked Billing draft and does not pretend that an old checkpoint exists.

The version/checkpoint comparison is logical binding under enumerated owner
paths, not a cryptographic digest of the old companion or a new DDL guarantee.
No supported writer changes the companion independently while retaining both
the compatibility envelope and financial version. Synchronization changes the
version and both fields; Shipping changes the version and writes canonical raw
evidence. An empty revision table alone is insufficient. Missing, contradictory,
malformed, unknown-version or unbound historical inputs remain not reusable.

## 5. Honest Unresolved Reuse

Copy the explicit supported reason from eligible persisted Billing evidence.
Do not infer a reason from zero amounts, empty checkpoint components, an opaque
context string, current configuration, or the legacy marker alone. Do not invent
a jurisdiction, exemption, rate or taxability. Replacement/Shipping retain their
existing unresolved-zero calculation and their existing line-taxability rules;
the new Invoice's unresolved final total reflects its own unchanged owner math.

## 6. Issued Immutability And Audit

No historical Invoice/checkpoint, fingerprint, tax evidence, companion, totals,
lines or version is rewritten by decoding or this repair. No backfill, migration,
replay repair or caller-controlled upgrade. Existing financial owner operations
retain their established transaction behavior. A read projection must not be
mistaken for stored evidence; live before/after comparisons exclude only any new
read-only projection, while comparing every pre-existing financial/history field.

## 7. Pricing And Atomicity

Preserve original Sales-line selling evidence, existing proportional rounding,
base-Invoice selection, locks, authorization, request identity, suffix selection
and same-client rollback. No catalog/PBV2 pricing call. Tax rejection occurs
before suffix/Invoice allocation and rolls back obligation, reopen, work, events
and request reservation. No-charge behavior and all original history stay intact.

## 8. Proof And Release Gates

One implementer, then independent adversarial review. Exercise the full user
matrix with actual producer/issuer/consumer SQL and relevant Billing/Fulfillment
DDL in PGlite, not an idealized tax fixture alone. Prove immutable raw images,
compatibility negatives, actual coordinator rollback/replay, shipping reuse,
tenant/authority checks and source-price divergence. No scanner/debt weakening.
No migration is planned; stop before adding one if required. Full canonical
validation and builds precede DEV-only push and the guarded deployment watch.
Live validation uses preserved ORD-1021 only after its preconditions still hold;
stop after one additional Invoice's number, frozen price, evidence and history
are verified. A remaining live failure ends this run without a second repair.
