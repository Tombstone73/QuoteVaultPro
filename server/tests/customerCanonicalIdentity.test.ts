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
const SYNCED_INVOICE_ID = `invoice_customer_identity_${suffix}`;

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
  await db.execute(sql.raw(readFileSync(resolve(process.cwd(), "server/db/migrations_v2/0171_customer_merge_workflow.sql"), "utf8")));

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

  await insertCustomer(QB_SURVIVOR, "Signs Etc", "101");
  await insertCustomer(NAME_DUPLICATE, "Signs Etc.", null);
  await insertCustomer(SAME_QB_A, "Elite Printing", "200");
  await insertCustomer(SAME_QB_B, "Elite Printing Inc", "200");
  await insertCustomer(DIFF_QB_A, "Graphic Solutions", "300");
  await insertCustomer(DIFF_QB_B, "Graphic Solutions LLC", "299");

  await db.execute(sql`
    insert into external_identity_mappings (
      organization_id, entity_type, entity_id, source_system, source_entity_type, source_record_id, source_display_name
    )
    values (${ORG_ID}, ${"customer"}, ${NAME_DUPLICATE}, ${"infoflo"}, ${"company"}, ${"IF-SIGNS"}, ${"Signs Etc."})
    on conflict (organization_id, source_system, source_entity_type, source_record_id) do update
      set entity_id = excluded.entity_id, updated_at = now()
  `);

  await db.execute(sql`
    insert into invoices (
      id, organization_id, invoice_number, customer_id, status, created_by_user_id,
      subtotal, tax, total, subtotal_cents, tax_cents, shipping_cents, total_cents,
      external_accounting_id, qb_invoice_id, qb_sync_status, sync_status,
      invoice_version, accounting_approved_at, accounting_approved_by_user_id, accounting_approved_version
    ) values (
      ${SYNCED_INVOICE_ID}, ${ORG_ID}, ${Math.floor(Date.now() / 1000)}, ${DIFF_QB_B}, ${"billed"}, ${USER_ID},
      ${"10"}, ${"0"}, ${"10"}, ${1000}, ${0}, ${0}, ${1000},
      ${"qb-invoice-history"}, ${"qb-invoice-history"}, ${"synced"}, ${"synced"},
      ${7}, now(), ${USER_ID}, ${7}
    )
    on conflict (id) do nothing
  `);
});

afterAll(async () => {
  await db.execute(sql`delete from invoices where organization_id = ${ORG_ID}`);
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
      left: { id: "a", companyName: "Elite Printing", externalAccountingId: "200", status: "active" },
      right: { id: "b", companyName: "Elite Printing Inc", externalAccountingId: "200", status: "active" },
      preferredSurvivorId: "b",
    });

    expect(decision).toMatchObject({
      action: "merge",
      survivorCustomerId: "b",
      duplicateCustomerId: "a",
      requiresReviewedAction: false,
      quickBooksCustomerId: "200",
    });
  });

  test("different QuickBooks IDs merge with the lower numeric ID independently of the local survivor", () => {
    const decision = decideCustomerMerge({
      left: { id: "a", companyName: "Graphic Solutions", externalAccountingId: "300", status: "active" },
      right: { id: "b", companyName: "Graphic Solutions LLC", externalAccountingId: "299", status: "active" },
      preferredSurvivorId: "a",
    });

    expect(decision).toMatchObject({
      action: "merge",
      survivorCustomerId: "a",
      duplicateCustomerId: "b",
      reason: "lowest_quickbooks_id_retained",
      quickBooksCustomerId: "299",
      retiredQuickBooksCustomerIds: ["300"],
    });
  });

  test("only one record has a QuickBooks ID and the operator may keep either local customer", () => {
    const decision = decideCustomerMerge({
      left: { id: "qb", companyName: "Signs Etc", externalAccountingId: "299", status: "active" },
      right: { id: "secondary", companyName: "Signs Etc.", externalAccountingId: null, status: "active" },
      reviewed: true,
      preferredSurvivorId: "secondary",
    });

    expect(decision).toMatchObject({
      action: "merge",
      survivorCustomerId: "secondary",
      duplicateCustomerId: "qb",
      requiresReviewedAction: true,
      quickBooksCustomerId: "299",
    });
  });

  test("malformed QuickBooks customer IDs fail closed with an actionable merge block", () => {
    const decision = decideCustomerMerge({
      left: { id: "a", companyName: "Graphic Solutions", externalAccountingId: "299", status: "active" },
      right: { id: "b", companyName: "Graphic Solutions LLC", externalAccountingId: "QB-300", status: "active" },
    });

    expect(decision).toMatchObject({ action: "block", code: "INVALID_QUICKBOOKS_CUSTOMER_ID" });
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

  test("backend merge retains lower QuickBooks ID on the chosen survivor without invoking a provider", async () => {
    const result = await mergeDuplicateCustomers({
      organizationId: ORG_ID,
      survivorCustomerId: DIFF_QB_A,
      duplicateCustomerId: DIFF_QB_B,
      actorUserId: USER_ID,
      reviewed: true,
    });

    expect(result.success).toBe(true);
    expect(result.quickBooksResolution).toMatchObject({
      survivorOriginalQuickBooksCustomerId: "300",
      sourceOriginalQuickBooksCustomerId: "299",
      retainedQuickBooksCustomerId: "299",
      retiredQuickBooksCustomerIds: ["300"],
    });
    const resultRows = await db.execute(sql`
      select id, external_accounting_id, merged_into_customer_id
      from customers
      where id in (${DIFF_QB_A}, ${DIFF_QB_B})
      order by id
    `);
    const rows = (resultRows as any).rows ?? [];
    expect(rows.find((row: any) => row.external_accounting_id === "299")).toBeTruthy();
    expect(rows.find((row: any) => row.merged_into_customer_id === DIFF_QB_A)).toBeTruthy();

    const historicalInvoice = await db.execute(sql`
      select customer_id, external_accounting_id, qb_invoice_id, qb_sync_status, sync_status,
             invoice_version, accounting_approved_at, accounting_approved_by_user_id, accounting_approved_version
      from invoices where id = ${SYNCED_INVOICE_ID}
    `);
    expect((historicalInvoice as any).rows?.[0]).toMatchObject({
      customer_id: DIFF_QB_A,
      external_accounting_id: "qb-invoice-history",
      qb_invoice_id: "qb-invoice-history",
      qb_sync_status: "synced",
      sync_status: "synced",
      invoice_version: 7,
      accounting_approved_by_user_id: USER_ID,
      accounting_approved_version: 7,
    });
    expect((historicalInvoice as any).rows?.[0]?.accounting_approved_at).toBeTruthy();
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
