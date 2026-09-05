# M7.2C clone provenance

## Status: representative physical clone proven; control-plane provenance incomplete

The supplied database endpoint was used only by short-lived, direct PostgreSQL processes. Its endpoint fingerprint is `sha256(host)[0:16]=a762b7a9a538a8f2`; it is distinct from the M7.2A production endpoint fingerprint. No credential is recorded here.

At the first repeatable-read, read-only baseline, the target reported `neondb`, user `neondb_owner`, a 194-row Drizzle ledger ending at `1788048000046`, the M0180--M0184 V2 foundation, absent later V2 domain relations, and the same aggregate V1 counts audited in production: 350 orders, 478 production jobs, 257 invoices, and 24 payments. This is sufficient physical evidence that the target is representative of the audited production shape.

The supplied connection grant did not expose Neon control-plane metadata. Parent branch/project ID, Neon source cut timestamp, configured TTL, clone display name, deletion owner, and a provider-confirmed deletion operation therefore remain unverified. The endpoint was never supplied to an application runtime; all work was database-only, so it was not reachable through a production service from this rehearsal.

## Cleanup

No temporary credential was persisted. The child branch was not deleted because the connection URL carries no Neon branch-management authority. The authorized Neon infrastructure owner must delete the endpoint whose safe fingerprint is `a762b7a9a538a8f2`; production was not modified.
