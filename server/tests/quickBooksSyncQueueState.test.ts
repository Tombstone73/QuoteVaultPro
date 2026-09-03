import { expect, test } from '@jest/globals';
import {
  countQueueStates,
  invoiceQueueState,
  matchesQueueView,
  paymentQueueState,
} from '../services/quickbooksSyncQueueState';

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
