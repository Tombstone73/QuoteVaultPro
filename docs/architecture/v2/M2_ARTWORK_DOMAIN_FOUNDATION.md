# M2.0 — Artwork Domain Foundation

## Repository findings and shape selection

V2 modules use narrow typed contracts and compose cross-module work through a
caller-owned PostgreSQL transaction. M0 supplies operation-request reservation,
principal attribution, and shared semantic audit rows. Sales owns the durable
Order and OrderLine identities; Routing owns frozen Route Instances, whose
tenant-scoped OrderLine foreign key already prevents a routed imaginary job.
Permission Sets issue the current Principal and `AuthorityPolicy` is the only
capability decision point. V2 migrations are hand-authored additive SQL and
are replayed only against the guarded disposable PostgreSQL clone.

Accordingly, Artwork has an explicit typed `ArtworkAssignment -> OrderLine`
relationship. It does not use an unconstrained polymorphic owner reference,
and it never writes Sales or Routing tables. The relationship has composite
foreign keys to both the Order subtype and its Line, which physically prevents
an attachment to a Quote line or cross-organization OrderLine.

## Ownership and identity

Artwork owns one durable fundamental file fact: `ArtworkFile`. **Customer Art
and Production Art are NOT separate fundamental file entities.** A file has an
opaque storage-object reference, immutable source/provenance facts, optional
detected file facts, and optional `derivedFromArtworkFileId` lineage. A modified
prepress output is another `ArtworkFile`; it does not overwrite or version the
source file.

`ArtworkAssignment` expresses how a file participates in a real OrderLine.
Its `purpose` is one of `customer_supplied`, `production`, `proof`, or
`reference`. Purpose is a usage fact, never a file subtype. One ArtworkFile can
therefore be assigned to both customer-supplied/front and production/front,
or intentionally to production/front and production/back.

## Addressability semantics

The assignment separately stores:

- `purpose` — why the file is being used;
- optional `side` (`front` or `back`) — independently meaningful physical side;
- optional zero-based `sourcePageIndex` — one selected source PDF/page;
- optional `layerKey` and non-negative `layerOrder` — independent layer identity
  and ordering.

These orthogonal fields avoid a combinatorial role enum. They make a future
Prepress unit addressable at the file/purpose/side/page/layer granularity
without imposing a single state per Order or OrderLine. M2.0 intentionally does
not decide which of multiple production candidates is current; that selection
and historical replacement policy belongs to a later named workflow operation.

## Storage and adoption boundary

`ArtworkObjectReference` is an opaque typed identity (`storageProvider`,
`objectKey`, optional version). An `ArtworkObjectStorageAdapter` can resolve it
outside domain authority. Browser URLs/tokens are neither persisted as file
identity nor accepted as authority. M2.0 performs no storage upload or TEMP
universe: an authenticated caller adopts an already-complete stored object only
while atomically creating its durable ArtworkFile and first legitimate
OrderLine assignment. Thus a failed adoption leaves neither an Artwork row nor
an assignment behind. Any future staging system remains outside Artwork until
that atomic adoption point.

## Lineage, removal, and future seams

Derived lineage is same-organization, cannot self-reference, and is
cycle-protected in PostgreSQL. Source deletion is restricted; no M2.0 hard
delete or storage deletion endpoint exists. Assignment removal is deliberately
deferred until a named history/currentness policy is defined, so business
history cannot be silently erased.

Artwork is intentionally state-light. Proofing owns proof decisions; Prepress
owns per-unit execution/release; Production owns execution. Generated previews,
thumbnails, page renders, dimensions, and checksum facts have metadata seams
on ArtworkFile but are not rendering pipelines and are not additional Artwork
files by default. A future rendition module may attach generated asset metadata
after it establishes retention and provenance rules.

## Transaction, authorization, audit, and idempotency

Each mutation (`adopt`, `assign`, `derive`) requires a matching M0 business
request and a fresh tenant-scoped Principal. M2.0 adds only `artwork.view`,
`artwork.adopt`, and `artwork.assign`; `artwork.adopt` covers first adoption
and derivation, while `artwork.assign` covers adding an existing file usage.
The service reserves the M0 operation before persistence, records principal
attribution and a shared `v2_audit_events` semantic event, then completes the
operation in the same caller-owned transaction. Replays return the persisted
result. A differing payload for the same request conflicts.

Each exact assignment has a canonical semantic fingerprint, unique for its
OrderLine in the tenant. Concurrent identical assignment requests therefore
converge on one durable fact. Different files may both be production/front;
M2.0 does not prematurely impose future current-production uniqueness.

## Physical invariants

PostgreSQL enforces organization-safe ArtworkFile/lineage and
ArtworkAssignment/file references with composite FKs. Assignment additionally
references the typed Order subtype and Sales line tuple, preventing Quote or
imaginary work attachment. Checks validate purpose, side, non-negative page and
layer order, layered-key consistency, metadata measurements, storage identity,
and self-lineage. A recursive trigger rejects multi-row lineage cycles, while
restrictive FKs prevent destructive source deletion.

## Validation and intentionally deferred work

Focused contracts prove multi-purpose/side/layer/page use, derived lineage,
replay idempotency, and deny-before-reservation locally. The guarded clone
rehearsal is the required physical proof for tenant isolation, concurrent M0
coordination, audit/attribution, rollback, and invalid direct SQL; its outcome
is intentionally reported separately rather than inferred from unit tests.
M1 quote, routing, order/draft invoice, conversion, and shared-Sales contracts
remain regression suites.

Deferred: object upload adapters and UI, staged-object recovery, rendition
generation, assignment removal/current-production selection, Proofing,
Prepress, Production, route advancement, and all fulfillment/billing changes.
