# Customer and Contact Migration Workflow

Status phrase: Deployable but not yet live-validated.

## 1. Existing Architecture Discovered

Printers Hero already supports the required person/company mobility model.

- Companies are stored in `customers`.
- People are stored independently in `customer_contacts`.
- Relationships are stored in `customer_contact_links`.
- `customer_contacts.customer_id` is now a deprecated compatibility field; relationship membership lives in `customer_contact_links`.
- A contact can be linked to multiple customers, and existing tests cover multi-customer linking, unlinking without deletion, and marking relationships former.
- Quotes, orders, invoices, portal, and proof workflows still use `customerId` as the company/account scope and optional `contactId` for person-specific workflow context.

## 2. Schema Changes Made

Migration `server/db/migrations_v2/0109_customer_contact_migration_workflow.sql` adds:

- Relationship metadata on `customer_contact_links`: `is_proof`, `role`, `source_system`, `source_record_id`, `start_date`, `end_date`, `notes`.
- Reusable `external_identity_mappings`.
- Staging tables:
  - `customer_contact_import_batches`
  - `customer_contact_import_company_records`
  - `customer_contact_import_contact_records`
  - `customer_contact_import_relationship_records`

Existing migrations were not altered.

## 3. Matching Rules Implemented

Implemented in `server/services/customerContactMigration/matching.ts`.

Company matching order:

1. Existing QuickBooks Customer ID.
2. Existing InfoFlo company Entry ID.
3. Exact QuickBooks Customer Name.
4. Exact normalized company name.
5. Strong multi-field candidate scoring.
6. Manual review via ambiguous status.

Contact matching order:

1. Existing InfoFlo Contact Entry ID.
2. Exact normalized non-generic email.
3. Exact mobile phone.
4. Exact first + last name + related company.
5. Strong composite match.
6. Manual review via ambiguous status.

Generic inboxes such as `accounting@`, `orders@`, `info@`, `graphics@`, and `sales@` are not treated as unique person identity.

## 4. Source Precedence Rules

QuickBooks is staged as the preferred source for accounting identity and company accounting fields. InfoFlo company data is staged as enrichment/fallback and migration metadata. InfoFlo contacts are staged as the preferred person and relationship source.

Finalization avoids overwriting `externalAccountingId` during update of an existing customer unless it is being persisted through the external identity path.

## 5. TEMP to PERMANENT Transition

Before finalization:

- Uploaded/parsing data is staged in import batch tables.
- Permanent `customers`, `customer_contacts`, `customer_contact_links`, and `external_identity_mappings` are not changed.

During finalization:

- The batch is locked and moved to `finalizing`.
- Companies, contacts, relationships, external IDs, and audit log records are written in a database transaction.
- The batch becomes `completed`, `completed_with_exceptions`, or `failed`.

## 6. Failure and Recovery Behavior

Finalization requires explicit `FINALIZE` confirmation and platform step-up auth. On failure, the transaction rolls back where supported, the batch is marked `failed`, and `failing_stage` / `error_message` are recorded. Empty insert arrays and empty `IN` clauses are guarded.

## 7. Files Changed

- `shared/schema.ts`
- `server/db/migrations_v2/0109_customer_contact_migration_workflow.sql`
- `server/db/migrations_v2/meta/_journal.json`
- `server/services/customerContactMigration/matching.ts`
- `server/services/customerContactMigration/service.ts`
- `server/routes/platform.ts`
- `client/src/lib/api/platform.ts`
- `client/src/pages/admin/CustomerContactMigrationPage.tsx`
- `client/src/pages/platform/PlatformDeveloperToolsPage.tsx`
- `client/src/App.tsx`
- `client/src/config/routes.ts`
- `server/tests/customerContactMigrationMatching.test.ts`

## 8. Migrations Added

- `0109_customer_contact_migration_workflow.sql`

## 9. Tests Added

- `server/tests/customerContactMigrationMatching.test.ts`

Coverage includes QuickBooks ID matching, InfoFlo rerun IDs, normalized suffixes, ambiguous company names, generic emails, mobility/multiple-company contact matching, blank/system contacts, Main Contact mapping, and empty input arrays.

## 10. Static Validation Completed

- `npm run check`
- `npm run db:migrations:v2:check-journal`

## 11. Automated Tests Completed

Windows-safe command used because the package test script quotes `NODE_OPTIONS` in a way PowerShell/cmd cannot execute:

```powershell
$env:NODE_OPTIONS='--max-old-space-size=8192 --experimental-vm-modules'; npx jest --runTestsByPath server/tests/customerContactMigrationMatching.test.ts --runInBand
```

Result: 12 tests passed.

## 12. Deployment Status

Not deployed from this workspace.

## 13. MAIN Dry-Run Validation Status

Not completed. Do not describe this workflow as fully validated until a MAIN dry run and a finalized test batch have both been successfully verified.

## 14. Remaining Unknowns

- Exact Titan Graphics QuickBooks customer export format to be pasted/uploaded into the JSON source box.
- Whether proof email should eventually become a first-class dedicated field beyond relationship metadata/evidence.
- Whether additional manual review actions should be expanded into row-level edit endpoints beyond the first staged workflow.
- Whether existing production data has duplicate QuickBooks IDs that need cleanup before finalization.

## 15. Titan Graphics Migration Steps

1. Deploy the migration and app changes.
2. Apply migration `0109_customer_contact_migration_workflow.sql`.
3. Open Platform Developer Tools.
4. Open Customer & Contact Migration.
5. Select the Titan Graphics target organization.
6. Paste/select the QuickBooks customer JSON source.
7. Upload the InfoFlo company CSV.
8. Upload the InfoFlo contacts CSV.
9. Click Parse, Validate, and Match.
10. Review source stats, staged rows, unresolved counts, conflicts, rejected records, and reports.
11. Download and review completed mappings, exceptions, rejected records, conflicts, and failed records.
12. Resolve unresolved records before live use.
13. Run a MAIN dry run with actual Titan Graphics files.
14. Review sample mappings and counts with the business owner.
15. Run a finalized test batch in a safe tenant.
16. Only after both validations succeed, type `FINALIZE` and finalize the approved production batch.
