# M2.1 — Proofing Domain Foundation

## Reconnaissance and ownership

V2 already separates durable commercial work (`OrderLine`), Artwork identity and
usage (`ArtworkFile` / `ArtworkAssignment`), and frozen Routing identity
(`RouteInstance`). Routing has no implemented step-completion operation in this
milestone. Consequently M2.1 never writes Routing tables, rebuilds a route, or
infers Prepress/Production readiness from a proof decision.

Proofing owns proof workflow history: a Proof Work, immutable Proof Versions,
issuance, and an authoritative reviewer response. Artwork continues to own the
file and storage reference; Sales continues to own the OrderLine; Routing
continues to own route position. A proof approval is only an approval of the
exact issued Proof Version.

## Model and lifecycle

`ProofWork` is one durable identity per tenant-scoped OrderLine. It is created
explicitly rather than automatically for every OrderLine, so no-route and
non-proof work are not silently forced into Proofing. Version history belongs
to that single work identity.

`ProofVersion` has a positive, unique sequence within its Proof Work and holds
one or more ordered references to existing `ArtworkAssignment` records. The
database verifies that each assignment belongs to the exact same OrderLine.
This preserves the proofed Artwork evidence without duplicating ArtworkFiles or
copying their mutable metadata. An issued version and its Artwork composition
are historical and cannot be edited.

`ProofResponse` is one immutable authoritative outcome for one issued Version:
`approved` or `revision_requested`. A revision request retains optional bounded
feedback but creates neither Artwork nor a later version. A later version may
only be created after the current version has a revision request. Only the
latest issued version can receive a response. These rules prevent a stale
version from becoming the current decision and prevent contradictory outcomes.

No mutable coarse workflow state is persisted: the current proofing position is
derived from ordered Version, issuance, and response facts. Approval does not
mean Prepress complete, production ready, production started, or Routing
advanced.

## Attribution and future portal seam

All mutations use the M0 operation-request coordinator in the caller-owned
transaction. The shared operation record, truthful principal attribution, and
shared semantic Audit event are committed together with the Proofing fact.
`proof.view`, `proof.prepare`, `proof.issue`, and `proof.respond` are the only
new narrow capabilities.

Staff may record a customer response only with the actual Order customer ID;
that creates `staff_recorded_customer` provenance and preserves the Staff actor.
Direct Portal responses are a typed future seam, not a public endpoint. Before
either a mutation or an M0 replay, the service resolves the exact Proof Work
customer and asks `AuthorityPolicy` to enforce the Portal customer ceiling.
No Staff identity is fabricated for a Portal responder.

## Physical database invariants

Migrations 0199 and 0200 provide composite tenant foreign keys from Proof Work to the
Sales Order subtype and OrderLine, from Version to Work, from proof evidence to
Artwork assignment/file, and from Response to Version/customer. A Proof Work
cannot attach to a Quote line or cross-tenant work. PostgreSQL enforces unique
work-per-line, unique version sequence, one response per version, valid
outcomes/origins/principal tuples, and non-empty bounded feedback.

The evidence trigger is intentionally raw PostgreSQL because a normal foreign
key cannot compare the OrderLine reached through two distinct parent chains.
It rejects an Artwork assignment from another line and blocks evidence changes
after issuance. A separate issuance trigger rejects an issued Version with no
Artwork evidence. Additional triggers make issued provenance and responses
immutable. Restrictive FKs prevent ordinary historical deletion; M2.1 exposes
no generic delete, void, or correction endpoint.

## Transactions, concurrency, and Routing boundary

The application service locks the Proof Work before selecting/creating the next
Version or deciding a response. The physical sequence uniqueness is a second
line of defence. M0 reservation/replay makes repeated create, issue, and
response requests converge. An approval-versus-revision race has one durable
winner and one conflict; duplicate approval requests replay the single response.

Proofing has no Routing dependency or side effect in M2.1. An eventual explicit
Routing completion operation can be composed at an application boundary after
the Routing module owns such an operation. This avoids mutating frozen route
instances or advancing unrelated lines.

## Read/service surface and deferred work

The typed service exposes bounded work history reads plus start work, create
version from real Artwork assignments, issue, approve, and request revision.
There is deliberately no broad proof CRUD, customer portal endpoint, email
delivery, chat/annotation system, Proofing UI redesign, Prepress state,
Production state, route advancement, or proof-file storage implementation.

Existing Lovable Proofing reference screens are useful visual workflow evidence,
but their mock statuses and local actions are not persistence authority. A
future UI/API milestone must map them to these facts without introducing a
second Artwork or Routing state system.

## Validation evidence

The M2.1 contract test checks narrow capabilities, response linkage, and bounded
feedback validation. The guarded disposable PostgreSQL rehearsal applies all
migrations through 0200 and proves tenant FKs, immutable issued/response facts,
same-line Artwork evidence, current-version rules, M0 replay, concurrent version
and response races, Audit/attribution, rollback, and frozen Routing stability.
The clone result is reported with the milestone validation rather than inferred
from local TypeScript alone.
