import { afterAll, beforeAll, expect, test } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, pool } from '../db';
import { customers, orderLineItems, organizations, products, users } from '@shared/schema';
import { OrdersRepository } from '../storage/orders.repo';
import { QuotesRepository } from '../storage/quotes.repo';
import { getOrderTravelerSource } from '../services/orderTravelerSourceService';

// The runner supplies a dedicated loopback PostgreSQL cluster and destroys it.
const org = randomUUID(), otherOrg = randomUUID(), actor = randomUUID(), customer = randomUUID(), product = randomUUID();
const orderRepo = new OrdersRepository(db), quoteRepo = new QuotesRepository(db);
const line = (description: string, displayOrder: number) => ({
  productId: product, productName: 'Synthetic traveler product', description,
  productType: 'wide_roll', width: 24, height: 36, quantity: displayOrder + 1,
  selectedOptions: [], linePrice: 24, unitPrice: 24, totalPrice: 24,
  displayOrder, pbv2SnapshotJson: {}, taxAmount: '0.00', isTaxableSnapshot: true,
  priceBreakdown: { basePrice: 24, optionsPrice: 0, total: 24, formula: '' },
  requiresDesign: false, requiresPrepress: false, requiresProofApproval: false,
});

beforeAll(async () => {
  await db.insert(organizations).values([
    { id: org, name: 'Synthetic traveler tenant', slug: org },
    { id: otherOrg, name: 'Unrelated traveler tenant', slug: otherOrg },
  ]);
  await db.insert(users).values({ id: actor, email: `${actor}@example.invalid`, role: 'owner' });
  await db.insert(customers).values({ id: customer, organizationId: org, companyName: 'Synthetic buyer' });
  await db.insert(products).values({ id: product, organizationId: org, name: 'Synthetic traveler product', description: 'Synthetic only', requiresProductionJob: false });
});
afterAll(async () => { await pool.end(); });

test('converted and edited Order traveler excludes retained cancellations and physically deleted lines', async () => {
  const quote = await quoteRepo.createQuote(org, {
    userId: actor, customerId: customer, customerName: 'Synthetic buyer', source: 'internal',
    status: 'draft', taxAmount: 0, taxableSubtotal: 24,
    lineItems: [line('Current line', 0), line('Historically removed line', 1), line('Physically deleted line', 2)],
  });
  const converted = await orderRepo.convertQuoteToOrder(org, quote.id, actor, { productionIntakePolicy: 'deferred' });
  const saved = await orderRepo.getOrderById(org, converted.id);
  expect(saved?.lineItems).toHaveLength(3);
  const [active, historical, deleted] = saved!.lineItems;
  await db.update(orderLineItems).set({ status: 'canceled', workflowState: 'canceled' }).where(eq(orderLineItems.id, historical.id));
  await orderRepo.deleteOrderLineItem(deleted.id);

  const traveler = await getOrderTravelerSource(org, converted.id);
  expect(traveler).toMatchObject({ orderId: converted.id, orderNumber: converted.orderNumber });
  expect(traveler?.lineItems).toMatchObject([{ orderLineItemId: active.id, description: active.description, quantity: Number(active.quantity) }]);
  expect(traveler?.lineItems).toHaveLength(1);
  expect(await getOrderTravelerSource(otherOrg, converted.id)).toBeNull();
  expect((await orderRepo.getOrderById(org, converted.id))?.lineItems).toHaveLength(2); // History remains.

  await db.update(orderLineItems).set({ status: 'voided' }).where(eq(orderLineItems.id, active.id));
  expect(await getOrderTravelerSource(org, converted.id)).toBeNull();
});
