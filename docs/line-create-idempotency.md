# V1 line creation request receipts

Migration `0216_line_create_requests` adds durable receipts for:

- `POST /api/order-line-items`
- `POST /api/quotes/:id/line-items`
- `POST /api/line-items/temp`

These endpoints require `Idempotency-Key: <epoch milliseconds>:<UUID>`.
Older open clients must refresh after the backend update. Authorization still
runs before receipt lookup. Scope includes tenant, actor, `line_create`, document
type, document ID, and request key. Unsaved Quote artwork lines use a distinct
`quote_draft` scope with the authenticated actor as the temporary document context.

The receipt holds a SHA-256 request hash and canonical line ID, not another copy
of the commercial payload. Replays return that canonical line. Changed payloads
conflict; distinct keys permit identical lines. Removed/moved results cannot be
recreated by replay. PostgreSQL transaction advisory locks serialize document creates across
workers; a unique index also enforces identity. The receipt and
line insert share one transaction, including Order financial rollups and Quote
bundle/tax totals. Existing post-commit Order scheduling is not repeated on replay.

Frontend guards act synchronously, before React pending state renders. An uncertain
failure retains the original key and frozen create payload. Local Quote line
save/artwork entry points share one identity and reconcile later edits through
the existing PATCH path. A failed Quote create never manufactures an ID-less
fallback draft. Explicit Duplicate creates a fresh intent.

## Retention

Receipts expire 30 days after the request key timestamp. Startup and hourly cleanup
remove at most 1,000 expired receipts per tick. Cleanup never deletes canonical
lines. Expired request keys are rejected even after receipt deletion, preventing
late retries from becoming new inserts. A future clock skew of up to five minutes
is allowed. Clients with a larger clock error must correct their clock.

## Validation

Focused suites: `lineCreateRequests.test.ts`, `lineCreateFrontendHandlers.test.ts`,
and `client/src/lib/lineCreateIntent.test.tsx`. The transaction model is explicitly
not PostgreSQL evidence. `lineCreateRequests.integration.test.ts` requires a safe,
dedicated `TEST_DATABASE_URL`; the normal test setup migrates that test database.
The integration suite then uses an isolated schema with fixture line tables and
the actual receipt migration. It exercises the production service against real
PostgreSQL locks, unique constraints, rollback, conflicts, and cleanup.

Run TypeScript/Jest with at least `--max-old-space-size=8192`. Never use a DEV or
MAIN application database for the integration suite.
