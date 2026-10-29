# QuickBooks customer state/province import

## Verified code path and loss point

Settings → Integrations → customer preview → confirm calls
`POST /api/integrations/quickbooks/sync/pull` with `resources: ['customers']`.
The sync processor dispatches to `processPullCustomers`, which fetches paginated
QuickBooks Customers and writes customer rows directly using Drizzle. It does
not pass through the Customer form or the reviewed contact migration importer.

The old `mapQBCustomerToLocal` saved BillAddr and ShipAddr as comma-separated
legacy text. It included `CountrySubDivisionCode` in that text but never assigned
`billingState` or `shippingState` (nor the other structured address fields).
The schema and persistence operations support those structured columns.
This establishes a mapping omission when the source provides a region; it does
not prove that a particular historical payload contained one.

The separate reviewed customer/contact migration path already maps structured
state/province fields and is unchanged. Original import payloads, actual customer
rows, and source QuickBooks records were unavailable during this correction:
no DATABASE_URL, test database, QuickBooks connector, or QA login was configured.
No live affected-customer counts have been measured.

## Import and repeat-sync policy

- Map BillAddr → billing and ShipAddr → shipping independently. Never borrow
  a region from the other address, city, postal code, or unstructured lines.
- Preserve trimmed `CountrySubDivisionCode` as supplied (abbreviation or full
  province/state name); do not force US-only codes. Preserve country separately.
- Preserve Line1 and combine Line2–Line5 into Street2. Values exceeding local
  column limits are not truncated; that address group requires manual review.
- New imports populate structured fields and retain legacy address text.
- Subsequent pulls preserve populated local address fields, including unmarked
  staff corrections. Missing source fields never erase them. Address fields
  lack sufficient provenance to distinguish every old staff edit from QB data,
  so enrichment is deliberately conservative, rather than treating all
  populated structured values as QB-owned.
- Any existing per-field address override or whole billing/shipping address
  override protects the entire corresponding group, including intentional blanks.
- Only enrich an existing address when all populated components agree and
  street, city and postal code establish the same address, or when exact legacy
  text matches that source with those anchors. An entirely empty, unprotected
  group can be populated by a future normal pull. Do not relocate an existing
  address automatically. Conflicts/partial matches require staff review.
- Non-address field ownership and existing customer/contact matching behavior
  are unchanged. Repeat pulls use the existing customer linkage. Customer writes
  take a tenant/source advisory transaction lock and a row lock before inspecting
  overrides/local values. Provider requests and contact upserts remain outside
  this transaction. Actual PostgreSQL locking has not been exercised here.

## Read-only assessment and proposed repairs

Run in an already authorized application/database context, with an explicit
organization ID. This tool has **no apply mode** and performs no Customer,
Order, Shipment, or QuickBooks business-data writes:

```powershell
npx tsx scripts/audit-quickbooks-customer-states.ts --organization-id=<id>
npx tsx scripts/audit-quickbooks-customer-states.ts --organization-id=<id> --read-quickbooks
```

The default reads only local QB-linked customer address fields in a read-only,
repeatable-read transaction. It reports linked customer counts, missing billing
and shipping regions on populated addresses, and linked customers without
addresses. Missing region is a completeness indicator, not a claim that every
country requires a state/province. Source-unread candidates are explicitly skipped.

`--read-quickbooks` uses the existing tenant-scoped migration-source reader to
make QuickBooks GET queries after the local snapshot transaction ends. Normal
OAuth token refresh/connection-health bookkeeping may update connection metadata;
it does not sync or modify customers or QuickBooks entities. A database role that
cannot perform that bookkeeping may require a pre-authorized application context.
Provider/driver failures return a safe generic failure, not partial repair advice.

Proposals contain only local customer ID, linked QB ID, address side, state field,
proposed value, and an evidence hash. Names, full addresses, emails, financials,
and credentials are excluded from the report. Keep report files out of Git.
Counts are scoped to exactly the supplied organization, including explicit skipped
inactive/merged records. Address-side counts can overlap for the same customer.

Skip existing state values, address overrides, conflicting/ambiguous addresses,
duplicate local QB linkages, duplicate source IDs, inactive/merged records,
missing source records, absent source state, and unsupported field lengths.
Do not match by name/email for repairs. The customer ID alone is insufficient:
each corresponding billing or shipping address must match. The hash is review
evidence, not a write authorization or concurrency guard. Any later separately
authorized repair must re-read and validate current linkage, overrides, address,
and blank state under a transaction lock before applying only the reviewed change.

**No data repair has been applied.** The script was not run against a live database.

## Existing Orders and Shipments

`server/routes/orders.routes.ts` snapshots customer billing/shipping values into
new Orders. Quote conversion in `server/storage/orders.repo.ts` also persists
bill-to/ship-to snapshots, preferring explicit Quote fields. Fulfillment's
customer-address selector can read current customer data as a choice/default,
but existing Order snapshots and explicit overrides are not automatically
rewritten when the customer changes. Existing shipment addresses are separate.

Correcting customers improves future address selection. Existing affected Order,
Quote and Shipment snapshots require separate read-only assessment and deliberate
review; a customer repair cannot be claimed to fix their persisted addresses.
No Order/shipping mapping or historical records were changed in this correction.

## Validation boundaries

Completed for this correction: 73 focused fixture/mocked tests across five suites;
scoped TypeScript on all five changed production files, zero diagnostics (8 GB
heap; existing repository OAuth declarations included). `git diff --check` passed.
The broader pagination suite passed 31 tests and failed the two baseline static
assertions described below. Its test file and the relevant Customer lookup query
are unchanged from the base commit. No full build or repository-wide check ran.

Pure fixture tests cover source mapping, distinct regions, absent values,
preservation, repeat imports, tenant scoping and dry-run exclusions. Mocked pull
service tests verify insert/update payloads and use of the transaction/lock
protocol, not database concurrency. Existing outgoing website/customer identity
regressions remain in scope. Two existing static pagination assertions expect a
single-candidate Customer lookup, but the baseline source already uses a bounded
20-candidate identity-safety lookup. That unchanged assertion mismatch is not a
state-import regression. Real database persistence/concurrency, original source
inspection, DEV, MAIN and browser validation remain unverified.
