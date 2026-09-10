import { expect, test } from '@jest/globals';
import {
  type QuickBooksSyncQueueState,
  countQueueStates,
  invoiceQueueState,
  matchesQueueView,
  paymentQueueState,
} from '../services/quickbooksSyncQueueState';

type QueueFixture = {
  id: string;
  resourceType: 'invoice' | 'payment';
  queueState: QuickBooksSyncQueueState;
  eligibility: 'queueable' | 'syncable' | 'blocked';
  displayNumber: string;
};

const fixture: QueueFixture[] = [
  { id: 'synced-invoice', resourceType: 'invoice', queueState: 'synced', eligibility: 'blocked', displayNumber: 'INV-100' },
  { id: 'queued-invoice', resourceType: 'invoice', queueState: 'queued', eligibility: 'syncable', displayNumber: 'INV-101' },
  { id: 'queued-payment', resourceType: 'payment', queueState: 'queued', eligibility: 'syncable', displayNumber: 'Payment QB-PAY-101 for INV-101' },
  { id: 'blocked-payment', resourceType: 'payment', queueState: 'unsynced', eligibility: 'blocked', displayNumber: 'Payment QB-PAY-102 for INV-102' },
  { id: 'unsynced-invoice', resourceType: 'invoice', queueState: 'unsynced', eligibility: 'queueable', displayNumber: 'INV-102' },
  { id: 'failed-payment', resourceType: 'payment', queueState: 'failed', eligibility: 'syncable', displayNumber: 'Payment QB-PAY-103 for INV-103' },
];

const inView = (view: 'all' | QuickBooksSyncQueueState, items = fixture) =>
  items.filter((item) => matchesQueueView(item.queueState, view));

test('derived native accounting work has one canonical state across cards and table views', () => {
  const states = [
    ...Array.from({ length: 234 }, () => paymentQueueState('not_synced', null)),
    ...Array.from({ length: 24 }, () => invoiceQueueState('pending')),
  ];

  const counts = countQueueStates(states);
  expect(counts).toEqual({ unsynced: 234, queued: 24, failed: 0, synced: 0 });
  expect(states.filter((state) => matchesQueueView(state, 'unsynced'))).toHaveLength(234);
  expect(states.filter((state) => matchesQueueView(state, 'queued'))).toHaveLength(24);
  expect(states.filter((state) => matchesQueueView(state, 'all'))).toHaveLength(258);
});

test('queue state classification preserves native unsynced, queued, failed, and synced records', () => {
  expect(invoiceQueueState('needs_resync')).toBe('unsynced');
  expect(invoiceQueueState('pending')).toBe('queued');
  expect(paymentQueueState('error', null)).toBe('failed');
  expect(paymentQueueState('not_synced', 'qb-payment-1')).toBe('synced');
});

test('a succeeded payment blocked by an unsynced invoice remains visible but cannot be queued until its invoice is ready', () => {
  // This reflects the persisted pending payment created by the payment
  // lifecycle. The parent-invoice prerequisite, rather than customer-facing
  // payment price/status, controls whether that work can enter the QB queue.
  expect(paymentQueueState('pending', null, false)).toBe('unsynced');
  expect(paymentQueueState('pending', null, true)).toBe('queued');
  expect(fixture.find((item) => item.id === 'blocked-payment')).toMatchObject({
    resourceType: 'payment',
    queueState: 'unsynced',
    eligibility: 'blocked',
    displayNumber: 'Payment QB-PAY-102 for INV-102',
  });
});

test('the canonical fixture keeps the State column and every top-level view aligned', () => {
  expect(inView('all').map((item) => item.id)).toEqual(fixture.map((item) => item.id));
  expect(inView('queued').map((item) => item.id)).toEqual(['queued-invoice', 'queued-payment']);
  expect(inView('queued').every((item) => item.queueState === 'queued')).toBe(true);
  expect(inView('unsynced').map((item) => item.id)).toEqual(['blocked-payment', 'unsynced-invoice']);
  expect(inView('failed').map((item) => item.id)).toEqual(['failed-payment']);
  expect(inView('synced').map((item) => item.id)).toEqual(['synced-invoice']);
});

test('the payment type view contains each payment lifecycle state without admitting invoices', () => {
  const paymentItems = fixture.filter((item) => item.resourceType === 'payment');
  expect(paymentItems.map((item) => item.id)).toEqual(['queued-payment', 'blocked-payment', 'failed-payment']);
  expect(paymentItems.filter((item) => matchesQueueView(item.queueState, 'unsynced')).map((item) => item.id)).toEqual(['blocked-payment']);
  expect(paymentItems.filter((item) => matchesQueueView(item.queueState, 'queued')).map((item) => item.id)).toEqual(['queued-payment']);
  expect(paymentItems.filter((item) => matchesQueueView(item.queueState, 'failed')).map((item) => item.id)).toEqual(['failed-payment']);
});

test('Queued counts, secondary filters, and pagination compose without changing canonical state', () => {
  const counts = countQueueStates(fixture.map((item) => item.queueState));
  const queued = inView('queued');
  expect(counts.queued).toBe(queued.length);
  expect(queued.filter((item) => item.displayNumber.includes('INV-101')).map((item) => item.id)).toEqual(['queued-invoice', 'queued-payment']);
  expect(queued.filter((item) => item.eligibility === 'syncable').map((item) => item.id)).toEqual(['queued-invoice', 'queued-payment']);
  expect(queued.slice(0, 1).map((item) => item.id)).toEqual(['queued-invoice']);
  expect(queued.slice(1, 2).map((item) => item.id)).toEqual(['queued-payment']);
});
