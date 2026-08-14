import { beforeAll, describe, expect, test } from "@jest/globals";
import { sql } from "drizzle-orm";
import { readFileSync } from "node:fs";
import path from "node:path";

import { hasSafeTestDatabase } from "./helpers/safeTestDatabase";

const root = process.cwd();
const source = (relativePath: string) => readFileSync(path.join(root, relativePath), "utf8");

describe("SCHEMA-001/002/003 runtime-schema repair contracts", () => {
  test("Drizzle declares the intended physical production-run FK and nullable contact-only order identity", () => {
    const schema = source("shared/schema.ts");
    const productionRunsStart = schema.indexOf('export const productionRuns = pgTable("production_runs"');
    const productionRunsEnd = schema.indexOf("export const productionRunMembers", productionRunsStart);
    const productionRuns = schema.slice(productionRunsStart, productionRunsEnd);
    const ordersStart = schema.indexOf('export const orders = pgTable("orders"');
    const ordersEnd = schema.indexOf("export const insertOrderSchema", ordersStart);
    const orders = schema.slice(ordersStart, ordersEnd);

    expect(productionRuns).toContain('orderId: varchar("order_id").references(() => orders.id, { onDelete: "set null" })');
    expect(orders).toContain('customerId: varchar("customer_id").references(() => customers.id, { onDelete: \'restrict\' })');
    expect(orders).not.toContain('customerId: varchar("customer_id").notNull()');
    expect(orders).toContain("// An order may be addressed to an independent contact.  Application code");
    expect(orders).toContain("// enforces that at least one of customerId/contactId is present.");
  });

  test("current artwork/prepress code can write retired files and the resolver remains lifecycle-aware", () => {
    const schema = source("shared/schema.ts");
    const retirementRoute = source("server/routes/prepressFiles.routes.ts");
    const runFileService = source("server/services/productionRunService.ts");
    const resolver = source("server/services/artwork/LineItemArtworkReadResolver.ts");

    expect(schema).toContain("pgEnum('line_item_file_status', ['active', 'superseded', 'retired'])");
    expect(retirementRoute).toContain('set({ status: "retired" })');
    expect(runFileService).toContain('set({ status: "retired" })');
    expect(resolver).toContain('status: "active" | "retired" | "superseded"');
    expect(resolver).toContain('eq(lineItemArtwork.status, "current")');
  });

  test("order creation and quote conversion permit contact-only identity but retain tenant-safe validation", () => {
    const repository = source("server/storage/orders.repo.ts");
    const identityStart = repository.indexOf("private async validateOrderIdentity");
    const identityEnd = repository.indexOf("async deleteOrder", identityStart);
    const identity = repository.slice(identityStart, identityEnd);
    const conversionStart = repository.indexOf("async convertQuoteToOrder");
    const conversionEnd = repository.indexOf("// Order line item operations", conversionStart);
    const conversion = repository.slice(conversionStart, conversionEnd);

    expect(identity).toContain('if (!customerId && !contactId)');
    expect(identity).toContain("ORDER_IDENTITY_REQUIRED");
    expect(identity).toContain("eq(customers.organizationId, organizationId)");
    expect(identity).toContain("eq(customerContacts.organizationId, organizationId)");
    expect(identity).toContain("ORDER_CONTACT_CUSTOMER_CONFLICT");
    expect(conversion).toContain("resolveOrderCustomerIdForContact");
    expect(conversion).toContain("await this.validateOrderIdentity(organizationId, resolvedCustomerId, resolvedContactId)");
  });

  test("the sole canonical hard-delete path rejects production history without conflating cancellation", () => {
    const repository = source("server/storage/orders.repo.ts");
    const routes = source("server/routes/orders.routes.ts");
    const storage = source("server/storage/index.ts");

    expect(repository).toContain("export class OrderDeletionProtectedError");
    expect(repository).toContain('"ORDER_DELETION_PRODUCTION_HISTORY"');
    expect(repository).toContain("statusCode = 409");
    expect(repository).toContain("productionRunMembers");
    expect(repository).toContain("async deleteOrder(organizationId: string, id: string)");
    expect(routes).toContain('app.delete("/api/orders/:id"');
    expect(routes).toContain("OrderDeletionProtectedError");
    expect(routes).toContain("error.statusCode");
    expect(routes).toContain("await storage.deleteOrder(organizationId, req.params.id)");
    expect(storage).toContain("export const deleteOrder = ordersRepo.deleteOrder.bind(ordersRepo);");
    // Cancellation remains a distinct workflow operation; hard delete must not
    // silently substitute a cancellation state transition.
    expect(repository.slice(repository.indexOf("async deleteOrder"), repository.indexOf("async convertQuoteToOrder"))).not.toContain("cancel");
  });

  test("the reusable physical audit checks all three repaired contracts in a read-only transaction", () => {
    const audit = source("scripts/db/auditPhysicalSchema.ts");

    expect(audit).toContain("BEGIN READ ONLY");
    expect(audit).toContain("SHOW transaction_read_only");
    expect(audit).toContain("line_item_file_status");
    expect(audit).toContain("orders.customer_id nullable");
    expect(audit).toContain("production_runs.order_id FK");
    expect(audit).toContain("TEST_DATABASE_URL is required");
    expect(audit).not.toContain("connectionString: process.env.DATABASE_URL");
  });

  test("the forward repair migration is idempotent and targets only the audited physical defects", () => {
    const migration = source("server/db/migrations_v2/0178_reconcile_runtime_critical_schema_contracts.sql");

    expect(migration).toContain("FROM pg_constraint");
    expect(migration).toContain("confdeltype = 'n'");
    expect(migration).toContain("DROP CONSTRAINT");
    expect(migration).toContain("FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE SET NULL");
    expect(migration).toContain("ALTER TYPE public.line_item_file_status ADD VALUE IF NOT EXISTS 'retired'");
    expect(migration).toContain("ALTER TABLE public.orders\n  ALTER COLUMN customer_id DROP NOT NULL");
    expect(migration).not.toContain("DELETE FROM");
    expect(migration).not.toContain("UPDATE public.orders");
  });
});

/**
 * The supplied disposable clone is named `neondb`, so the shared guard rightly
 * refuses to write to it. These are deliberate opt-in integration checks for a
 * separately named TEST_DATABASE_URL (for example, *_test or *_ci). They use
 * one transaction and always roll fixture writes back.
 */
const describeDatabase = hasSafeTestDatabase() ? describe : describe.skip;
const rollback = Symbol("schema-reconciliation-repair-rollback");

describeDatabase("SCHEMA-001/002/003 physical postconditions (safe TEST_DATABASE_URL required)", () => {
  let db: any;

  beforeAll(async () => {
    ({ db } = await import("../db"));
  });

  test("catalog has the non-destructive production-run order FK, retired enum value, and nullable orders.customer_id", async () => {
    const constraints = await db.execute(sql`
        select conname, confdeltype, pg_get_constraintdef(oid) as definition
        from pg_constraint
        where conrelid = 'public.production_runs'::regclass
      `);
    const orderFks = (constraints.rows as Array<{ definition: string; confdeltype: string }>).filter((row) => /foreign key \(order_id\) references (?:public\.)?orders\(id\)/i.test(row.definition));
    expect(orderFks).toHaveLength(1);
    expect(orderFks[0]?.definition).toMatch(/on delete set null/i);
    expect(orderFks[0]?.confdeltype).toBe("n");
    // `c` is PostgreSQL's catalog code for ON DELETE CASCADE. This verifies
    // that no direct order FK can cascade-delete a production run.
    expect(orderFks.some((row) => row.confdeltype === "c")).toBe(false);

    const enumValues = await db.execute(sql`
        select e.enumlabel
        from pg_type t
        join pg_namespace n on n.oid = t.typnamespace
        join pg_enum e on e.enumtypid = t.oid
        where n.nspname = 'public' and t.typname = 'line_item_file_status'
        order by e.enumsortorder
      `);
    expect((enumValues.rows as Array<{ enumlabel: string }>).map((row) => row.enumlabel)).toEqual(
      expect.arrayContaining(["active", "superseded", "retired"]),
    );

    const nullable = await db.execute(sql`
        select is_nullable
        from information_schema.columns
        where table_schema = 'public' and table_name = 'orders' and column_name = 'customer_id'
      `);
    expect(nullable.rows[0]?.is_nullable).toBe("YES");
  });

  test("Scenario A: canonical hard delete rejects an order with production history without partial cleanup", async () => {
    const nonce = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const ids = {
      organization: `schema_repair_org_${nonce}`,
      user: `schema_repair_user_${nonce}`,
      contact: `schema_repair_contact_${nonce}`,
      product: `schema_repair_product_${nonce}`,
      order: `schema_repair_order_${nonce}`,
      line: `schema_repair_line_${nonce}`,
      job: `schema_repair_job_${nonce}`,
      run: `schema_repair_run_${nonce}`,
      member: `schema_repair_member_${nonce}`,
    };

    try {
      await db.transaction(async (tx: any) => {
        const { OrderDeletionProtectedError, OrdersRepository } = await import("../storage/orders.repo");
        await tx.execute(sql`insert into organizations (id, name, slug) values (${ids.organization}, ${`Schema Repair ${nonce}`}, ${`schema-repair-${nonce}`.slice(0, 95)})`);
        await tx.execute(sql`insert into users (id, email, role, is_admin, is_platform_admin) values (${ids.user}, ${`schema-repair-${nonce}@example.test`}, 'admin', true, false)`);
        await tx.execute(sql`insert into customer_contacts (id, organization_id, first_name, last_name, email, status) values (${ids.contact}, ${ids.organization}, 'Schema', 'Contact', ${`contact-${nonce}@example.test`}, 'active')`);
        await tx.execute(sql`insert into products (id, organization_id, name, description) values (${ids.product}, ${ids.organization}, ${`Schema Repair Product ${nonce}`}, 'Schema repair fixture')`);
        await tx.execute(sql`insert into orders (id, organization_id, order_number, customer_id, contact_id, created_by_user_id) values (${ids.order}, ${ids.organization}, ${`SR-${nonce}`.slice(0, 50)}, null, ${ids.contact}, ${ids.user})`);
        await tx.execute(sql`insert into order_line_items (id, order_id, product_id, description, quantity, unit_price, total_price) values (${ids.line}, ${ids.order}, ${ids.product}, 'Schema repair line', 1, 1, 1)`);
        await tx.execute(sql`insert into production_jobs (id, organization_id, order_id, line_item_id, station_key, step_key) values (${ids.job}, ${ids.organization}, ${ids.order}, ${ids.line}, 'flatbed', 'prepress')`);
        await tx.execute(sql`insert into production_runs (id, organization_id, order_id, run_number, station_key) values (${ids.run}, ${ids.organization}, ${ids.order}, 1, 'flatbed')`);
        await tx.execute(sql`insert into production_run_members (id, organization_id, production_run_id, production_job_id, order_line_item_id, allocated_quantity, remaining_quantity) values (${ids.member}, ${ids.organization}, ${ids.run}, ${ids.job}, ${ids.line}, 1, 1)`);

        const repository = new OrdersRepository(tx);
        await expect(repository.deleteOrder(ids.organization, ids.order)).rejects.toBeInstanceOf(OrderDeletionProtectedError);
        await expect(repository.deleteOrder(ids.organization, ids.order)).rejects.toMatchObject({
          code: "ORDER_DELETION_PRODUCTION_HISTORY",
          statusCode: 409,
        });

        const [order, line, job, run, member] = await Promise.all([
          tx.execute(sql`select id from orders where id = ${ids.order}`),
          tx.execute(sql`select id from order_line_items where id = ${ids.line}`),
          tx.execute(sql`select id from production_jobs where id = ${ids.job}`),
          tx.execute(sql`select id, order_id from production_runs where id = ${ids.run}`),
          tx.execute(sql`select id from production_run_members where id = ${ids.member}`),
        ]);
        expect(order.rows).toEqual([{ id: ids.order }]);
        expect(line.rows).toEqual([{ id: ids.line }]);
        expect(job.rows).toEqual([{ id: ids.job }]);
        expect(run.rows).toEqual([{ id: ids.run, order_id: ids.order }]);
        expect(member.rows).toEqual([{ id: ids.member }]);

        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }
  });

  test("Scenario B: canonical hard delete succeeds for an otherwise disposable order", async () => {
    const nonce = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const ids = {
      organization: `schema_repair_disposable_org_${nonce}`,
      user: `schema_repair_disposable_user_${nonce}`,
      contact: `schema_repair_disposable_contact_${nonce}`,
      order: `schema_repair_disposable_order_${nonce}`,
    };

    try {
      await db.transaction(async (tx: any) => {
        const { OrdersRepository } = await import("../storage/orders.repo");
        await tx.execute(sql`insert into organizations (id, name, slug) values (${ids.organization}, ${`Schema Repair Disposable ${nonce}`}, ${`schema-repair-disposable-${nonce}`.slice(0, 95)})`);
        await tx.execute(sql`insert into users (id, email, role, is_admin, is_platform_admin) values (${ids.user}, ${`schema-repair-disposable-${nonce}@example.test`}, 'admin', true, false)`);
        await tx.execute(sql`insert into customer_contacts (id, organization_id, first_name, last_name, email, status) values (${ids.contact}, ${ids.organization}, 'Schema', 'Disposable', ${`contact-disposable-${nonce}@example.test`}, 'active')`);
        await tx.execute(sql`insert into orders (id, organization_id, order_number, customer_id, contact_id, created_by_user_id) values (${ids.order}, ${ids.organization}, ${`SR-D-${nonce}`.slice(0, 50)}, null, ${ids.contact}, ${ids.user})`);

        const repository = new OrdersRepository(tx);
        await expect(repository.deleteOrder(ids.organization, ids.order)).resolves.toBeUndefined();

        const deleted = await tx.execute(sql`select id from orders where id = ${ids.order}`);
        expect(deleted.rows).toEqual([]);

        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }
  });
});
