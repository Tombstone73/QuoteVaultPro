import { afterAll, beforeAll, expect, test } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { db, pool } from '../db';
import { organizations, users, customers, products, orders } from '@shared/schema';
import { dateOnlyDeadline, type OrderDeadline, type OrderDeadlineState } from '@shared/orderDeadline';
import { OrdersRepository } from '../storage/orders.repo';
import { QuotesRepository } from '../storage/quotes.repo';
import { FulfillmentDashboardRepo } from '../services/fulfillment/repository';
// The runner owns and destroys the whole loopback PostgreSQL cluster. No deployed data.
const org = `deadline-test-${randomUUID()}`, actor = randomUUID(), customer = randomUUID(), product = randomUUID();
const repo = new OrdersRepository(db), quoteRepo = new QuotesRepository(db);
const request = (kind: OrderDeadline['kind'], localTime: string | null = null): OrderDeadline => ({ ...dateOnlyDeadline('2026-11-10', 'Customer requested November 10 EOD'), kind, localTime });
const state = (value: OrderDeadline, accepted = true): OrderDeadlineState => ({ requested: value, accepted: accepted ? value : null });
const line = { productId: product, productName: 'Synthetic deadline product', description: 'Synthetic deadline product', productType: 'wide_roll', width: 24, height: 36, quantity: 1,
    selectedOptions: [], linePrice: 24, unitPrice: 24, totalPrice: 24, displayOrder: 0, pbv2SnapshotJson: {}, taxAmount: '0.00', isTaxableSnapshot: true, priceBreakdown: { basePrice: 24, optionsPrice: 0, total: 24, formula: '' },
    requiresDesign: false, requiresPrepress: true, requiresProofApproval: false };
beforeAll(async () => {
    await db.insert(organizations).values({ id: org, name: 'Isolated deadline tests', slug: org, settings: { timezone: 'America/Indiana/Indianapolis' } });
    await db.insert(users).values({ id: actor, email: `${actor}@example.invalid`, role: 'owner' });
    await db.insert(customers).values({ id: customer, organizationId: org, companyName: 'Synthetic deadline buyer', status: 'active', creditLimit: '1000000', creditLimitConfiguredAt: new Date() });
    await db.insert(products).values({ id: product, organizationId: org, name: 'Synthetic deadline product', description: 'Synthetic test', requiresProductionJob: false });
});
afterAll(async () => { await pool.end(); });
async function create(deadlineJson?: OrderDeadlineState | null, dueDate: string | null = null) {
    return repo.createOrder(org, { customerId: customer, createdByUserId: actor, lineItems: [line], dueDate, deadlineJson, productionIntakePolicy: 'deferred' });
}
test.each<OrderDeadline['kind']>(['date_only', 'eod', 'time'])('%s persists through canonical create, update, and independent readback', async (kind) => {
    const proposal = request(kind, kind === 'time' ? '23:30' : null);
    const created = await create(state(proposal));
    expect(created.deadlineJson?.accepted).toMatchObject({ kind, timezone: 'America/Indiana/Indianapolis', instant: kind === 'time' ? '2026-11-11T04:30:00.000Z' : null });
    expect(created.dueDate?.slice(0, 10)).toBe('2026-11-10');
    await repo.updateOrder(org, created.id, { label: 'Staff notes retained' });
    const independent = new OrdersRepository(db);
    const readback = await independent.getOrderById(org, created.id);
    expect(readback?.deadlineJson).toEqual(created.deadlineJson);
    expect(readback?.label).toBe('Staff notes retained');
    const detail = await new FulfillmentDashboardRepo(db).getFulfillmentDetail(org, created.id);
    expect(detail?.deadlineJson).toEqual(created.deadlineJson);
    expect(await independent.getOrderById('unrelated-tenant', created.id)).toBeUndefined();
});
test('legacy dates remain date-only; legacy date edits clear obsolete time semantics', async () => {
    const legacy = await create(undefined, '2020-01-02');
    await repo.updateOrder(org, legacy.id, { label: 'Unrelated change' });
    expect((await repo.getOrderById(org, legacy.id))?.deadlineJson).toBeNull();
    expect((await repo.getOrderById(org, legacy.id))?.dueDate?.slice(0, 10)).toBe('2020-01-02');
    const timed = await create(state(request('time', '16:00')));
    await repo.updateOrder(org, timed.id, { dueDate: '2026-11-12' });
    expect((await repo.getOrderById(org, timed.id))?.deadlineJson?.accepted).toMatchObject({ kind: 'date_only', date: '2026-11-12', instant: null, localTime: null });
});
test('requested-only deadline never becomes an accepted commitment', async () => {
    const created = await create(state(request('eod'), false));
    expect(created.dueDate).toBeNull();
    expect(created.requestedDueDate?.slice(0, 10)).toBe('2026-11-10');
    expect(created.deadlineJson?.accepted).toBeNull();
});
test('Quote requested EOD/time survive save/reload and canonical conversion; acceptance is explicit', async () => {
    for (const kind of ['eod', 'time'] as const) {
        const proposal = request(kind, kind === 'time' ? '16:15' : null);
        const quote = await quoteRepo.createQuote(org, { userId: actor, customerId: customer, customerName: 'Synthetic deadline buyer', source: 'internal', status: 'draft', taxAmount: 0, taxableSubtotal: 24, lineItems: [line], deadlineJson: state(proposal, false) });
        const readback = await quoteRepo.getQuoteById(org, quote.id);
        expect(readback?.deadlineJson?.requested?.kind).toBe(kind);
        const converted = await repo.convertQuoteToOrder(org, quote.id, actor, { productionIntakePolicy: 'deferred' });
        expect(converted.dueDate).toBeNull();
        expect(converted.deadlineJson?.requested).toEqual(readback?.deadlineJson?.requested);
        expect(converted.deadlineJson?.accepted).toBeNull();
        // A second Quote demonstrates explicit acceptance without mutating the source request.
        const second = await quoteRepo.createQuote(org, { userId: actor, customerId: customer, customerName: 'Synthetic deadline buyer', source: 'internal', status: 'draft', taxAmount: 0, taxableSubtotal: 24, lineItems: [line], deadlineJson: state(proposal, false) });
        const accepted = await repo.convertQuoteToOrder(org, second.id, actor, { productionIntakePolicy: 'deferred', deadlineJson: state(proposal) });
        expect(accepted.deadlineJson?.accepted?.kind).toBe(kind);
        expect(accepted.deadlineJson?.accepted?.instant).toBe(kind === 'time' ? '2026-11-10T21:15:00.000Z' : null);
        expect((await repo.convertQuoteToOrder(org, second.id, actor, { productionIntakePolicy: 'deferred' })).id).toBe(accepted.id);
    }
});
test('invalid DST updates roll back without changing the existing Order', async () => {
    const created = await create(state(request('eod')));
    await expect(repo.updateOrder(org, created.id, { deadlineJson: state({ ...request('time', '02:30'), date: '2026-03-08' }) })).rejects.toMatchObject({ code: 'ORDER_DEADLINE_INVALID' });
    expect((await repo.getOrderById(org, created.id))?.deadlineJson).toEqual(created.deadlineJson);
});
test('PostgreSQL forbids a fake timestamp for EOD', async () => {
    const created = await create(state(request('eod')));
    await expect(db.execute(sql `update orders set deadline_json=${JSON.stringify(state({ ...request('eod'), instant: '2026-11-11T04:59:59Z' }))}::jsonb where id=${created.id}`)).rejects.toThrow();
    expect((await db.select().from(orders).where(eq(orders.id, created.id)))[0].deadlineJson).toEqual(created.deadlineJson);
});
