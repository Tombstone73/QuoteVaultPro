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
  queueState: QuickBooksSyncQueueState;
  eligibility: 'queueable' | 'syncable' | 'blocked';
  displayNumber: string;
};

const fixture: QueueFixture[] = [
  { id: 'synced-invoice', queueState: 'synced', eligibility: 'blocked', displayNumber: 'INV-100' },
  { id: 'queued-invoice', queueState: 'queued', eligibility: 'syncable', displayNumber: 'INV-101' },
  { id: 'queued-payment', queueState: 'queued', eligibility: 'syncable', displayNumber: 'Payment for INV-101' },
  { id: 'unsynced-invoice', queueState: 'unsynced', eligibility: 'queueable', displayNumber: 'INV-102' },
  { id: 'failed-payment', queueState: 'failed', eligibility: 'syncable', displayNumber: 'Payment for INV-103' },
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

test('the canonical fixture keeps the State column and every top-level view aligned', () => {
  expect(inView('all').map((item) => item.id)).toEqual(fixture.map((item) => item.id));
  expect(inView('queued').map((item) => item.id)).toEqual(['queued-invoice', 'queued-payment']);
  expect(inView('queued').every((item) => item.queueState === 'queued')).toBe(true);
  expect(inView('unsynced').map((item) => item.id)).toEqual(['unsynced-invoice']);
  expect(inView('failed').map((item) => item.id)).toEqual(['failed-payment']);
  expect(inView('synced').map((item) => item.id)).toEqual(['synced-invoice']);
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
