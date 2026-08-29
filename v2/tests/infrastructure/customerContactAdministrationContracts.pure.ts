import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const service = source("v2/infrastructure/customers/postgresCustomerContactAdministration.ts");
const reader = source("v2/infrastructure/compatibility/postgresCustomerWorkspaceRead.ts");
const migration = source("server/db/migrations_v2/0241_v2_customer_contact_command_revisions.sql");

assert.match(service, /customer_contact_links SET is_primary=false/);
assert.match(service, /customer_contact_links SET is_primary=true/);
assert.match(service, /ct\.status='active'/);
assert.match(service, /Select another Primary Contact before deactivating/);
assert.match(service, /customer_portal_access/);
assert.match(service, /PostgresOperationRequestRepository/);
assert.match(service, /v2_audit_events/);
assert.match(service, /crm_revision=crm_revision\+1/);
assert.match(service, /organization_id=\$1 AND customer_id=\$2 AND contact_id=\$3/);
assert.match(reader, /contactReadiness/);
assert.match(reader, /customer_contact_links/);
assert.match(migration, /customers[\s\S]*crm_revision/);
assert.match(migration, /customer_contacts[\s\S]*crm_revision/);
console.log("[customer-contact-administration] canonical primary, Portal protection, tenancy, audit, idempotency, and read readiness contracts present.");
