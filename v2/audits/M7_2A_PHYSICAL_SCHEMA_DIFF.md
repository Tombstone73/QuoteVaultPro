# M7.2A physical schema diff

**Source of truth:** a production pg_catalog/information_schema fingerprint in a verified REPEATABLE READ READ ONLY session as printershero_m7_audit. It captured relation, column, default, constraint, index, type, sequence, trigger, routine, view, policy, extension, and relation-size metadata. It contains no customer or business-row values.

## Physical schema truth

- PostgreSQL 17.11, database neondb; 234 public tables.
- 15 V2 tables exist, exactly the M0180 foundation trio and M0181 permission family.
- The V2 subset has 110 columns, 62 constraints, 33 indexes, six active triggers, no row-security policies, and no views.
- Extensions: pgcrypto and plpgsql. The required gen_random_uuid dependency exists.
- The full public catalog contains 1,155 constraints, 1,086 indexes, 868 type entries, 12 triggers, 44 routines, and no public views/materialized views.

## Present, physically catalogued objects

| Family | Present physical postconditions |
| --- | --- |
| M0180 operation foundation | v2_operation_requests, v2_principal_attributions, v2_outbox_messages; primary/composite unique/FK/check constraints and expected worker indexes are present. |
| M0181 permission foundation | all 12 permission/portal tables; customers(id, organization_id) and customer_portal_access(id, organization_id) unique constraints are present. |
| M0182-M0184 permission hardening | permission-set principal-kind check, kind immutability trigger, assignment-kind triggers, and admin-floor trigger surface are present. |
| M0185-M0186 final physical surface | v2_assert_permission_admin_floor, v2_reject_permission_set_kind_change, v2_validate_permission_assignment_kind; deferred admin-floor triggers on membership, permission sets/capabilities, and staff assignments are present. Historic byte provenance remains divergent. |

## Missing relation objects: conclusive

| Migration range | Required physical relations absent from PROD |
| --- | --- |
| M0187-M0191 sales | v2_sales_document_number_counters, v2_sales_documents, v2_sales_quote_details, v2_sales_order_details, v2_sales_document_lines, v2_sales_quote_checkpoints, v2_sales_quote_conversions |
| M0192 audit | v2_audit_events |
| M0193-M0194 routing | v2_route_templates, v2_route_template_steps, v2_route_instances, v2_route_instance_steps |
| M0195 billing | v2_billing_invoices, v2_billing_invoice_lines |
| M0197-M0198 artwork | v2_artwork_files, v2_artwork_assignments |
| M0199 proofing | v2_proof_works, v2_proof_versions, v2_proof_version_artwork, v2_proof_responses |

These 20 absent relations also mean their required column types/defaults, primary and scoped foreign keys, unique/check constraints, indexes, triggers, and functions cannot satisfy the journaled chain.

## Legacy/base-table postcondition differences

- M0187's expected legacy unique constraints on products and customer_contacts are not catalogued.
- M0193's expected product_types routing_mode/default_route_template_id and routing policy/check/FK are absent.
- M0195's sales-linked foreign keys/uniques cannot exist because their referenced sales/billing relations are absent.
- M0196 is a permission-set data repair. Its target data state is intentionally unclassified: the restricted role has no grant to inspect permission-set seed rows.
- Existing legacy PBV2, proof, and production compatibility columns do not substitute for the missing V2 relation families.

## Unexpected / non-equivalence observations

- The physical V2 foundation is not a complete M0199 schema even though the ledger ends at M0199.
- v2_operation_requests and v2_outbox_messages have no rows in the prior aggregate audit; this is not a schema defect, but confirms no recorded V2 operational workload at that snapshot.
- V2 tables are owned by neondb_owner and have no public RLS policies. Ownership/policy posture must be reviewed in the later repair design, not modified here.
- No public views exist; no current-repository V2 view postcondition is being claimed.

## Physical comparison boundary

A relation-name match was never treated as equivalence. The comparison includes catalogued definitions for columns/defaults/nullability, constraints, indexes, types, triggers, routines, sequences, policies, and extensions. Exact historical function definitions and permission seed data remain UNKNOWN_PROVENANCE because current source bytes diverge after M0184 and the audit grant intentionally excludes those data tables.

## Future reconciliation input

Start from the actual physical M0180-M0184-compatible foundation, preserve the M0185/M0186-like trigger surface until equivalence is established, and add only new forward-only, idempotent reconciliation steps. Do not replay or edit M0185-M0199.
