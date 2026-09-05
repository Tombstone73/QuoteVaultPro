# M7.1 production read-only baseline

**Disposition: BLOCKED.**  This is a factual, no-write baseline record, not a
cutover approval.  Audit work ran on 2026-09-04 using source
`e77808b37883051c05a44e33328f923fd99bf179` on clean `dev`; it was reconciled
with `origin/dev` at the identical SHA.

## Safety result

No production database connection was opened and no production query was
issued.  No production write, provider call, email, queue claim, migration,
webhook replay, or deployment was performed.

The available database credential is named `TEST_DATABASE_URL`.  Its neutral
database identity and absent production/Railway provenance cannot positively
establish PrintersHero production, and it was therefore not used.  No
separately authorized production read-only role, target allowlist, or
production database identity was available.

This fails the M7.1 production-read gate before any business or catalog query:
the target cannot be positively identified and an explicitly read-only session
cannot be proven.

## Existing tooling assessment

| Path | Safe use | M7.1 production result |
| --- | --- | --- |
| `scripts/db/auditPhysicalSchema.ts` | Disposable DEV/CI `TEST_DATABASE_URL`; `BEGIN READ ONLY`, verifies `SHOW transaction_read_only`, catalog-only reads, rollback/end | Do not repurpose: it has no production identity allowlist. |
| `scripts/audit-migration-integrity-0109-0114.ts` | Historical/local inspection | Not a production gate: accepts `DATABASE_URL`, identifies after connect, and does not prove `transaction_read_only`. |
| `v2/scripts/devHistoricalDataHygienePolicy.ts` | Proven DEV inventory primitive: repeatable-read/read-only verification and guaranteed rollback/release | Correctly hard-gated to `PrintersHero-DEV / Development`; it must remain DEV-only. |

## Migration and schema baseline

Production migration journal, highest migration, duplicate/gap state, table
occupancy, extensions, and V2 schema compatibility are **not observed**.  The
Post-M6 reports establish only DEV evidence; they cannot be projected onto
production.

The next authorized production audit tool must accept only a distinct audit
role/URL with independently verified production provenance, redact identity
output, reject ambiguous scope before business reads, execute `BEGIN
TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`, verify
`transaction_read_only = on`, allow only bounded `SELECT`/catalog queries, and
always roll back, release, and close on both success and failure.

## Production service identity observations

Unauthenticated GET-only discovery found the public site reachable at
`www.printershero.com`.  `api.printershero.com/{health,ready,version}` returned
frontend HTML rather than an API identity; corresponding `/api/*` paths on the
public host returned 404.  `mcp.printershero.com/` returned the default nginx
page.  These results establish neither deployed backend version nor writer
topology, and no mutation endpoint was contacted.

## DEV comparison baseline

Post-M6 DEV is the sole comparable evidence: its final validation records the
same source/deployed SHA, healthy/ready DEV service, and zero database/provider
mutations by its read-only inventory.  It records retained history including
ambiguous delivery attempts, pending financial outbox entries, historical
ProductVersions, compatibility fields, and routing fixtures.  PROD state shapes
remain unknown rather than assumed absent or corrupt.

## Required unblock

Provide a separately authorized production audit role/connection and an
independent safe identity source (service/project/database allowlist).  Then
run the bounded, fail-closed audit described above; do not use a generic
`DATABASE_URL`, DEV credential, or application mutation path.
