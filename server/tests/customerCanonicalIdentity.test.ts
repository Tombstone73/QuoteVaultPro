import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { sql } from "drizzle-orm";
import { db } from "../db";
import {
  createCustomerContactForOrganization,
  getAllCustomers,
  getCustomerContacts,
} from "../storage";
import {
  CustomerIdentityConflictError,
  decideCustomerMerge,
  mergeDuplicateCustomers,
} from "../services/customerCanonicalIdentityService";

const suffix = `${Date.now()}_${Math.floor(Math.random() * 99999)}`;
const ORG_ID = `org_customer_identity_${suffix}`;
const USER_ID = `user_customer_identity_${suffix}`;

const QB_SURVIVOR = `cust_qb_survivor_${suffix}`;
const NAME_DUPLICATE = `cust_name_duplicate_${suffix}`;
const SAME_QB_A = `cust_same_qb_a_${suffix}`;
const SAME_QB_B = `cust_same_qb_b_${suffix}`;
const DIFF_QB_A = `cust_diff_qb_a_${suffix}`;
const DIFF_QB_B = `cust_diff_qb_b_${suffix}`;

async function insertCustomer(id: string, companyName: string, externalAccountingId: string | null = null) {
  await db.execute(sql`
    insert into customers (id, organization_id, company_name, status, customer_type, current_balance, credit_limit, external_accounting_id)
    values (${id}, ${ORG_ID}, ${companyName}, ${"active"}, ${"business"}, ${"0"}, ${"0"}, ${externalAccountingId})
    on conflict (id) do nothing
  `);
}

beforeAll(async () => {
  await db.execute(sql.raw(readFileSync(resolve(process.cwd(), "server/db/migrations_v2/0079_contact_relationships.sql"), "utf8")));
  await db.execute(sql.raw(readFileSync(resolve(process.cwd(), "server/db/migrations_v2/0109_customer_contact_migration_workflow.sql"), "utf8")));
  await db.execute(sql.raw(readFileSync(resolve(process.cwd(), "server/db/migrations_v2/0111_customer_portal_bulk_onboarding.sql"), "utf8")));

  await db.execute(sql`
    insert into organizations (id, name, slug)
    values (${ORG_ID}, ${"Customer Identity Test Org"}, ${`customer-identity-${suffix}`})
    on conflict (id) do nothing
  `);

  await db.execute(sql`
    insert into users (id, email, role, is_admin, is_platform_admin)
    values (${USER_ID}, ${`customer-identity-${suffix}@test.com`}, ${"admin"}, ${false}, ${false})
    on conflict (id) do nothing
  `);

  await insertCustomer(QB_SURVIVOR, "Signs Etc", "QB-SIGNS");
  await insertCustomer(NAME_DUPLICATE, "Signs Etc.", null);
  await insertCustomer(SAME_QB_A, "Elite Printing", "QB-ELITE");
  await insertCustomer(SAME_QB_B, "Elite Printing Inc", "QB-ELITE");
  await insertCustomer(DIFF_QB_A, "Graphic Solutions", "QB-GRAPHIC-1");
  await insertCustomer(DIFF_QB_B, "Graphic Solutions LLC", "QB-GRAPHIC-2");

  await db.execute(sql`
    insert into external_identity_mappings (
      organization_id, entity_type, entity_id, source_system, source_entity_type, source_record_id, source_display_name
    )
    values (${ORG_ID}, ${"customer"}, ${NAME_DUPLICATE}, ${"infoflo"}, ${"company"}, ${"IF-SIGNS"}, ${"Signs Etc."})
    on conflict (organization_id, source_system, source_entity_type, source_record_id) do update
      set entity_id = excluded.entity_id, updated_at = now()
  `);
});

afterAll(async () => {
  await db.execute(sql`delete from external_identity_mappings where organization_id = ${ORG_ID}`);
  await db.execute(sql`delete from customer_contact_links where organization_id = ${ORG_ID}`);
  await db.execute(sql`delete from customer_contacts where organization_id = ${ORG_ID}`);
  await db.execute(sql`delete from customers where organization_id = ${ORG_ID}`);
  await db.execute(sql`delete from users where id = ${USER_ID}`);
  await db.execute(sql`delete from organizations where id = ${ORG_ID}`);
});

describe("canonical customer identity", () => {
  test("same QuickBooks ID consolidates deterministically", () => {
    const decision = decideCustomerMerge({
      left: { id: "a", companyName: "Elite Printing", externalAccountingId: "QB-1", status: "active" },
      right: { id: "b", companyName: "Elite Printing Inc", externalAccountingId: "QB-1", status: "active" },
      preferredSurvivorId: "b",
    });

    expect(decision).toMatchObject({
      action: "merge",
      survivorCustomerId: "b",
      duplicateCustomerId: "a",
      requiresReviewedAction: false,
      quickBooksCustomerId: "QB-1",
    });
  });

  test("different QuickBooks IDs block automatic merge", () => {
    const decision = decideCustomerMerge({
      left: { id: "a", companyName: "Graphic Solutions", externalAccountingId: "QB-1", status: "active" },
      right: { id: "b", companyName: "Graphic Solutions LLC", externalAccountingId: "QB-2", status: "active" },
    });

    expect(decision.action).toBe("block");
    if (decision.action === "block") {
      expect(decision.code).toBe("QUICKBOOKS_ID_CONFLICT");
    }
  });

  test("only one record has QuickBooks ID, and that record survives after review", () => {
    const decision = decideCustomerMerge({
      left: { id: "qb", companyName: "Signs Etc", externalAccountingId: "QB-SIGNS", status: "active" },
      right: { id: "secondary", companyName: "Signs Etc.", externalAccountingId: null, status: "active" },
      reviewed: true,
    });

    expect(decision).toMatchObject({
      action: "merge",
      survivorCustomerId: "qb",
      duplicateCustomerId: "secondary",
      requiresReviewedAction: true,
    });
  });

  test("reviewed merge preserves InfoFlo identity, moves contact link, and search returns canonical customer", async () => {
    const contact = await createCustomerContactForOrganization(ORG_ID, NAME_DUPLICATE, {
      firstName: "Kraig",
      lastName: "Snowden",
      email: `kraig.${suffix}@signshuntington.com`,
      isPrimary: true,
    });

    const result = await mergeDuplicateCustomers({
      organizationId: ORG_ID,
      survivorCustomerId: QB_SURVIVOR,
      duplicateCustomerId: NAME_DUPLICATE,
      actorUserId: USER_ID,
      reviewed: true,
      reason: "Signs Etc duplicate repair",
    });

    expect(result.success).toBe(true);
    expect(result.counts.contactLinksMoved).toBeGreaterThanOrEqual(1);

    const survivorContacts = await getCustomerContacts(QB_SURVIVOR);
    expect(survivorContacts.some((row) => row.id === contact.id)).toBe(true);

    const identityRows = await db.execute(sql`
      select entity_id
      from external_identity_mappings
      where organization_id = ${ORG_ID}
        and source_system = 'infoflo'
        and source_entity_type = 'company'
        and source_record_id = 'IF-SIGNS'
    `);
    expect((identityRows as any).rows?.[0]?.entity_id).toBe(QB_SURVIVOR);

    const searchResults = await getAllCustomers(ORG_ID, { search: "Kraig" });
    expect(searchResults.map((customer) => customer.id)).toEqual([QB_SURVIVOR]);
    expect(searchResults[0]?.contacts?.some((row) => row.id === contact.id)).toBe(true);
  });

  test("backend merge rejects different QuickBooks IDs without moving records", async () => {
    await expect(mergeDuplicateCustomers({
      organizationId: ORG_ID,
      survivorCustomerId: DIFF_QB_A,
      duplicateCustomerId: DIFF_QB_B,
      actorUserId: USER_ID,
      reviewed: true,
    })).rejects.toBeInstanceOf(CustomerIdentityConflictError);
  });

  test("same QuickBooks ID merge is idempotent and does not duplicate contact links", async () => {
    const contact = await createCustomerContactForOrganization(ORG_ID, SAME_QB_B, {
      firstName: "Elite",
      lastName: "Buyer",
      email: `elite.buyer.${suffix}@example.com`,
    });

    await mergeDuplicateCustomers({
      organizationId: ORG_ID,
      survivorCustomerId: SAME_QB_A,
      duplicateCustomerId: SAME_QB_B,
      actorUserId: USER_ID,
      reviewed: false,
    });

    await mergeDuplicateCustomers({
      organizationId: ORG_ID,
      survivorCustomerId: SAME_QB_A,
      duplicateCustomerId: SAME_QB_B,
      actorUserId: USER_ID,
      reviewed: false,
    });

    const links = await db.execute(sql`
      select count(*)::int as count
      from customer_contact_links
      where organization_id = ${ORG_ID}
        and customer_id = ${SAME_QB_A}
        and contact_id = ${contact.id}
        and status <> 'removed'
    `);
    expect(Number((links as any).rows?.[0]?.count ?? 0)).toBe(1);
  });
});
