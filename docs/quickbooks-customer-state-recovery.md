# QuickBooks customer state recovery

## Read-only audit, 2026-11-03

The existing authenticated MAIN customer read returned 297 current records in one tenant
(also matching the customer page total). Separate status reads found 8 archived
records and no superseded records, bringing coverage to 305 total records. Each of the 233 distinct current stored QB IDs
was read through the existing tenant-scoped QuickBooks inspection endpoint. All
233 reads succeeded. Only address/linkage fields were retained for assessment;
customer names, contacts, financial values and credentials are excluded from the
saved plan. The canonical `assessQuickBooksCustomerStates` ran locally on that
evidence. MAIN customers and QuickBooks business records were not changed.

This was a sequential API snapshot, **not** an atomic database snapshot. Counts
are evidence at audit time, not authorization for a later write.

| Finding | Current | Archived, excluded from repair |
| --- | ---: | ---: |
| Customers audited | 297 | 8 |
| Stored QuickBooks links | 233 | 7 |
| Customers without a stored QB link | 64 | 1 |
| Blank billing state / shipping state | 275 / 284 | 7 / 7 |
| Both state fields blank, including empty addresses | 275 | 7 |
| Populated billing address missing state | 152 | 4 |
| Populated shipping address missing state | 26 | 1 |
| Customers with either populated-address deficiency | 155 | 4 |
| Customers with both populated-address deficiencies | 23 | 1 |
| Safely recoverable billing / shipping state fields | 29 / 0 | 0 / 0 |
| Customers with a safe proposal | 29 | 0 |

The 149 non-proposed address sides comprise 81 missing structured source states
(76 billing, 5 shipping), 29 address conflicts, 22 ambiguous address matches
(1 billing, 21 shipping), and 17 populated local addresses with no stored QB
link. There were no missing provider records for the 233 current stored IDs;
these are unique within the current records. Four archived link records share
IDs with current customers. None of the 29 proposals shares an archived QB ID.
One non-proposed current billing side lacks source state and also has archived
duplicate linkage; the full database audit prioritizes the duplicate-linkage
reason for that side. Archived records are never proposed, including their five
missing state/address sides. Their source IDs are not used to infer a match.
Of 155 affected current customers, 126 have no safe proposal;
14 of the 29 repairable customers also have an unresolved other address side.
These categories overlap at customer level and must not be added as customer
counts. Including the four affected archived customers, 159 customers have a
populated-address deficiency and 130 have no safe proposal. Blank address groups
are counted separately, never filled by this repair.

Current source records contain 83 structured billing states and 74 structured
shipping states, but most cannot safely be transferred to a corresponding local
address. Some source addresses also contain free-text location lines or malformed
components. No state is inferred from those lines, city, postal code, or the other
address side. Such records require deliberate source/address review.

The redacted current-customer plan and summary (including the separate archived
coverage check) are local ignored artifacts:
`node_modules/.cache/qb-live-state-plan.json` and `qb-live-state-summary.json`.
No raw address export is saved or committed.

## Existing importer

The original omission and import correction are documented in
[quickbooks-customer-state-import.md](quickbooks-customer-state-import.md).
Commit `5af63eba5` already maps `CountrySubDivisionCode` independently for BillAddr
and ShipAddr. Current `processPullCustomers` uses that mapper and preserves
populated fields and protected address groups. This task retains that importer;
it does not start a normal sync or change its non-address ownership behavior.

## Repair contract

`scripts/audit-quickbooks-customer-states.ts` remains read-only. It now includes
unlinked records in completeness counts, distinct affected-customer and address-side
counts, reason counts, and a versioned, source-backed proposal. `--output-file`
writes a new redacted file with exclusive creation, avoiding mixed provider logs
in a shell-redirection file. Evidence hashes use stable object-key ordering.

`scripts/repair-quickbooks-customer-states.ts` defaults to a database-enforced
read-only preview. It requires an explicit tenant, authorized tenant Owner/Admin
actor, reviewed file SHA-256, expected proposed-field count, and fresh provider
GETs. Apply additionally requires `--apply` and matching
`--confirm-organization-id`. There is no HTTP route or automatic repair hook.

The operation takes the importer's source advisory locks in sorted order and
locks current target/linkage rows. It rechecks duplicate linkage, active status,
overrides, matching address, blank state and the reviewed evidence identity.
Every update has tenant, local ID, source ID and blank-state predicates. Only
the selected state and `updatedAt` are changed; sync status, identifiers, other
address components, notes, financial fields and all accounting records are
preserved. Each changed state has an atomic audit record and returned persisted
readback. Any stale/conflicting selected field rolls back the entire operation.
Identical already-present values are preserved as idempotent no-ops without
duplicate audit records. A different nonempty state stops the operation.

Lock timeout is 5 seconds, statement and idle-transaction timeouts are 30 seconds,
and the operation checks a 60-second transaction deadline. An apply connection
failure with unknown commit outcome requires readback/idempotent retry, never a
normal customer resync or an assumption that no change occurred.

## Exact MAIN procedure — not executed by this task

1. Separately authorize promotion of this validated code and the specific MAIN
   data repair. Use an approved runner and confirm its MAIN database identity and
   tenant before loading credentials. Do not paste credentials into commands/chat
   or use DEV's database for a MAIN plan.
2. Set explicit values and create a **fresh** read-only plan in that context:

   ```powershell
   $stateRepairOrg = '<verified MAIN organization ID>'
   $stateRepairActor = '<Owner/Admin user ID in that organization>'
   $stateRepairPlan = '<new private absolute output path>.json'
   npx tsx scripts/audit-quickbooks-customer-states.ts --organization-id=$stateRepairOrg --read-quickbooks --output-file=$stateRepairPlan
   ```

3. Review the actual proposed rows and skips. Set the reviewed field count
   explicitly; **29 is this audit's observation, not a permanent expected count**.

   ```powershell
   $stateRepairCount = <reviewed proposed-state-field count>
   $stateRepairHash = (Get-FileHash -LiteralPath $stateRepairPlan -Algorithm SHA256).Hash.ToLowerInvariant()
   npx tsx scripts/repair-quickbooks-customer-states.ts --organization-id=$stateRepairOrg --actor-user-id=$stateRepairActor --plan-file=$stateRepairPlan --plan-sha256=$stateRepairHash --expected-fields=$stateRepairCount
   ```

4. Obtain explicit approval of this exact plan, tenant and count. Only then run:

   ```powershell
   npx tsx scripts/repair-quickbooks-customer-states.ts --organization-id=$stateRepairOrg --actor-user-id=$stateRepairActor --plan-file=$stateRepairPlan --plan-sha256=$stateRepairHash --expected-fields=$stateRepairCount --apply --confirm-organization-id=$stateRepairOrg
   ```

5. Review committed readback and audit counts. Re-run the same repair command:
   it must report zero updates and the expected already-present count. Run a new
   read-only audit to a different output file. If evidence, linkage or staff data
   changed, stop and prepare a new plan; never force a stale plan through.

Existing Order, Quote and Shipment address snapshots are not rewritten by this
customer repair and require separate assessment if needed. This task performs
no MAIN repair and does not change worker/automation settings.

## Validation

- 41 focused importer, repeat-pull, assessment, reviewed-plan and CLI guard tests
  passed across three suites.
- 10 real isolated PostgreSQL tests passed: enforced read-only preview, persisted
  billing/shipping separation, non-state preservation, atomic audit history,
  idempotent reruns, changed staff/source data, duplicate linkage, tenant/actor
  boundaries and an actual concurrent row-lock conflict. The repository's
  disposable PostgreSQL harness was used with a hidden-process Windows launch
  workaround; no production test database was used. The owned cluster was
  stopped and removed afterward.
- Scoped TypeScript checked all seven changed/new TypeScript files, including
  the tests, with the established 8192 MB heap: zero diagnostics.
- The live audit used real MAIN and QuickBooks GET responses. The apply path was
  exercised only against isolated synthetic PostgreSQL records. A future MAIN
  apply, post-repair live readback and deployment remain unverified.
