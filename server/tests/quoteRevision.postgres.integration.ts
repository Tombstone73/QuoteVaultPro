import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, test } from '@jest/globals';
import { and, eq } from 'drizzle-orm';
import { Pool } from 'pg';
import express from 'express';
import request from 'supertest';
import { db } from '../db';
import { auditLogs, organizations, products, quoteAttachments, quoteLineItems, quoteWorkflowStates, quotes, users } from '@shared/schema';
import { canonicalQuoteOperations, CanonicalQuoteOperationError } from '../services/quotes/canonicalQuoteOperations';
import { DrizzleInvestigationRepository } from '../services/investigation/investigationService';
import { registerQuoteRoutes } from '../routes/quotes.routes';

const created: Array<{ organizationId: string; userId: string }> = [];
const migration = readFileSync('server/db/migrations_v2/0228_quote_revision.sql', 'utf8');

async function fixture() {
  const suffix = randomUUID();
  const [organization] = await db.insert(organizations).values({ name: `Quote revision ${suffix}`, slug: `quote-revision-${suffix}` }).returning();
  const [user] = await db.insert(users).values({ email: `quote-revision-${suffix}@example.test`, firstName: 'Quote', lastName: 'Revision', role: 'admin' }).returning();
  created.push({ organizationId: organization.id, userId: user.id });
  const [quote] = await db.insert(quotes).values({ organizationId: organization.id, userId: user.id, status: 'draft', customerName: 'Fixture' }).returning();
  return { organization, user, quote };
}

async function current(id: string) {
  return (await db.select().from(quotes).where(eq(quotes.id, id)))[0];
}

afterEach(async () => {
  for (const row of created.splice(0)) {
    await db.delete(organizations).where(eq(organizations.id, row.organizationId));
    await db.delete(users).where(eq(users.id, row.userId));
  }
});

describe('Quote revision on isolated PostgreSQL', () => {
  test('header and commercial children advance the persisted revision and investigation time', async () => {
    const f = await fixture();
    const product = (await db.insert(products).values({ organizationId: f.organization.id, name: 'Fixture', description: 'Synthetic product' }).returning())[0];
    const initial = await current(f.quote.id);
    expect(initial.revision).toBe(1);
    const changed = await canonicalQuoteOperations.updateEditableHeader({ organizationId: f.organization.id, actorUserId: f.user.id, quoteId: f.quote.id, expectedRevision: initial.revision, changes: { customerNotes: 'Header edit' } });
    expect(changed.revision).toBe(initial.revision + 1);
    expect(changed.updatedAt.getTime()).toBeGreaterThanOrEqual(initial.updatedAt.getTime());

    const [line] = await db.insert(quoteLineItems).values({ quoteId: f.quote.id, productId: product.id, productName: 'Fixture', width: '1', height: '1', quantity: 1, pbv2SnapshotJson: {}, linePrice: '10', priceBreakdown: { basePrice: 10, optionsPrice: 0, total: 10, formula: '' } }).returning();
    expect((await current(f.quote.id)).revision).toBe(changed.revision + 1);
    await db.update(quoteLineItems).set({ linePrice: '11', optionSelectionsJson: { selected: ['sample'] } }).where(eq(quoteLineItems.id, line.id));
    expect((await current(f.quote.id)).revision).toBe(changed.revision + 2);
    await db.delete(quoteLineItems).where(eq(quoteLineItems.id, line.id));
    expect((await current(f.quote.id)).revision).toBe(changed.revision + 3);

    const [attachment] = await db.insert(quoteAttachments).values({ organizationId: f.organization.id, quoteId: f.quote.id, fileName: 'fixture.txt' }).returning();
    expect((await current(f.quote.id)).revision).toBe(changed.revision + 4);
    await db.delete(quoteAttachments).where(eq(quoteAttachments.id, attachment.id));
    const [workflow] = await db.insert(quoteWorkflowStates).values({ quoteId: f.quote.id }).returning();
    expect((await current(f.quote.id)).revision).toBe(changed.revision + 6);
    await db.delete(quoteWorkflowStates).where(eq(quoteWorkflowStates.id, workflow.id));
    const beforeNoOp = await current(f.quote.id);
    await db.update(quotes).set({ customerNotes: beforeNoOp.customerNotes }).where(eq(quotes.id, f.quote.id));
    expect((await current(f.quote.id)).revision).toBe(beforeNoOp.revision + 1);
  });

  test('two concurrent saves from one revision yield one write and one stale result', async () => {
    const f = await fixture();
    const before = await current(f.quote.id);
    const save = (value: string) => canonicalQuoteOperations.updateEditableHeader({ organizationId: f.organization.id, actorUserId: f.user.id, quoteId: f.quote.id, expectedRevision: before.revision, changes: { customerNotes: value } });
    const outcomes = await Promise.allSettled([save('First'), save('Second')]);
    expect(outcomes.filter((row) => row.status === 'fulfilled')).toHaveLength(1);
    const rejected = outcomes.find((row) => row.status === 'rejected');
    expect(rejected?.status).toBe('rejected');
    if (rejected?.status === 'rejected') {
      expect(rejected.reason).toBeInstanceOf(CanonicalQuoteOperationError);
      expect(rejected.reason.code).toBe('QUOTE_STALE');
    }
    expect((await current(f.quote.id)).revision).toBe(before.revision + 1);
    expect(await db.select().from(auditLogs).where(and(eq(auditLogs.entityId, f.quote.id), eq(auditLogs.actionType, 'UPDATE')))).toHaveLength(1);
  });

  test('investigation search orders edited Quotes by persisted update time and reports the same snapshot', async () => {
    const f = await fixture();
    const [newer] = await db.insert(quotes).values({ organizationId: f.organization.id, userId: f.user.id, status: 'draft', customerName: 'Fixture' }).returning();
    await canonicalQuoteOperations.updateEditableHeader({ organizationId: f.organization.id, actorUserId: f.user.id, quoteId: f.quote.id, expectedRevision: f.quote.revision, changes: { customerNotes: 'Edited for investigation' } });
    const repository = new DrizzleInvestigationRepository();
    const matches = await repository.search(f.organization.id, 'Fixture', ['quote'], 10);
    expect(matches.map((entry) => entry.resource.id).slice(0, 2)).toEqual([f.quote.id, newer.id]);
    const snapshot = await repository.get(f.organization.id, { type: 'quote', id: f.quote.id });
    expect(snapshot?.current.updatedAt).toBe((await current(f.quote.id)).updatedAt.toISOString());
  });

  test('Quote PATCH returns an actionable conflict and leaves a stale save unchanged', async () => {
    const f = await fixture();
    const product = (await db.insert(products).values({ organizationId: f.organization.id, name: 'Fixture', description: 'Synthetic product' }).returning())[0];
    await db.insert(quoteLineItems).values({ quoteId: f.quote.id, productId: product.id, productName: 'Fixture', width: '1', height: '1', quantity: 1, pbv2SnapshotJson: {}, linePrice: '10', priceBreakdown: { basePrice: 10, optionsPrice: 0, total: 10, formula: '' } });
    const revision = (await current(f.quote.id)).revision;
    const app = express();
    app.use(express.json());
    registerQuoteRoutes(app, {
      isAuthenticated: (req: express.Request, _res: express.Response, next: express.NextFunction) => { Object.assign(req, { user: { id: f.user.id, role: 'admin' } }); next(); },
      isAdmin: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
      tenantContext: (req: express.Request, _res: express.Response, next: express.NextFunction) => { Object.assign(req, { organizationId: f.organization.id, orgRole: 'admin' }); next(); },
    });
    const first = await request(app).patch(`/api/quotes/${f.quote.id}`).send({ expectedRevision: revision, customerNotes: 'First' });
    expect(first.status).toBe(200);
    const afterFirst = await current(f.quote.id);
    expect(afterFirst).toMatchObject({ customerNotes: 'First', revision: revision + 1 });
    const second = await request(app).patch(`/api/quotes/${f.quote.id}`).send({ expectedRevision: revision, customerNotes: 'Second' });
    expect(second.status).toBe(409);
    expect(second.body).toMatchObject({ code: 'QUOTE_STALE' });
    expect(await current(f.quote.id)).toMatchObject({ customerNotes: 'First', revision: revision + 1 });
  });

  test('repeated Quote detail reads do not advance revision or stale a normal header save', async () => {
    const f = await fixture();
    const [product] = await db.insert(products).values({ organizationId: f.organization.id, name: 'Fixture', description: 'Synthetic product' }).returning();
    await db.insert(quoteLineItems).values({ quoteId: f.quote.id, productId: product.id, productName: 'Fixture', width: '1', height: '1', quantity: 1, pbv2SnapshotJson: {}, linePrice: '10', priceBreakdown: { basePrice: 10, optionsPrice: 0, total: 10, formula: '' } });
    const app = express();
    app.use(express.json());
    registerQuoteRoutes(app, {
      isAuthenticated: (req: express.Request, _res: express.Response, next: express.NextFunction) => { Object.assign(req, { user: { id: f.user.id, role: 'admin' } }); next(); },
      isAdmin: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
      tenantContext: (req: express.Request, _res: express.Response, next: express.NextFunction) => { Object.assign(req, { organizationId: f.organization.id, orgRole: 'admin' }); next(); },
    });

    const first = await request(app).get(`/api/quotes/${f.quote.id}`);
    expect(first.status).toBe(200);
    const settled = await current(f.quote.id);
    const second = await request(app).get(`/api/quotes/${f.quote.id}`);
    expect(second.status).toBe(200);
    expect(second.body.revision).toBe(settled.revision);
    expect((await current(f.quote.id)).updatedAt).toEqual(settled.updatedAt);

    const saved = await request(app).patch(`/api/quotes/${f.quote.id}`).send({ expectedRevision: second.body.revision, customerNotes: 'Saved after detail reads' });
    expect(saved.status).toBe(200);
    expect((await current(f.quote.id)).customerNotes).toBe('Saved after detail reads');
  });

  test('audit failure rolls back the header, revision, and audit together', async () => {
    const f = await fixture();
    const before = await current(f.quote.id);
    // The invalid actor makes audit insertion fail after the Quote UPDATE.
    await expect(canonicalQuoteOperations.updateEditableHeader({ organizationId: f.organization.id, actorUserId: randomUUID(), quoteId: f.quote.id, expectedRevision: before.revision, changes: { customerNotes: 'Must roll back' } })).rejects.toThrow();
    const after = await current(f.quote.id);
    expect(after.customerNotes).toBe(before.customerNotes);
    expect(after.revision).toBe(before.revision);
    expect(after.updatedAt).toEqual(before.updatedAt);
    expect(await db.select().from(auditLogs).where(eq(auditLogs.entityId, f.quote.id))).toHaveLength(0);
  });

  test('migration accepts a present compatible schema and rejects incompatible column types', async () => {
    const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(migration);
      const present = await client.query(`SELECT data_type, is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='quotes' AND column_name='revision'`);
      expect(present.rows[0]).toMatchObject({ data_type: 'integer', is_nullable: 'NO' });
      await client.query('ROLLBACK');

      await client.query('BEGIN');
      await client.query('ALTER TABLE public.quotes ALTER COLUMN revision TYPE text');
      await expect(client.query(migration)).rejects.toThrow(/incompatible type text/);
      await client.query('ROLLBACK');
    } finally {
      client.release();
      await pool.end();
    }
  });

  test('migration initializes absent columns on legacy rows without using creation time', async () => {
    const f = await fixture();
    const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DROP TRIGGER quotes_advance_revision ON public.quotes');
      await client.query('ALTER TABLE public.quotes DROP COLUMN updated_at, DROP COLUMN revision');
      await client.query(`UPDATE public.quotes SET created_at = '2020-01-01' WHERE id = $1`, [f.quote.id]);
      await client.query(migration);
      const { rows } = await client.query(`SELECT revision, updated_at > created_at AS initialized_now, updated_at FROM public.quotes WHERE id = $1`, [f.quote.id]);
      expect(rows[0]).toMatchObject({ revision: 1, initialized_now: true });
      expect(rows[0].updated_at).toBeInstanceOf(Date);
      await client.query('ROLLBACK');
    } finally {
      client.release();
      await pool.end();
    }
  });
});
