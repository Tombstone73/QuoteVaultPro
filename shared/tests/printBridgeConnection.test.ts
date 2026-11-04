import { expect, test } from '@jest/globals';
import { bridgeConnectionLabel, bridgeConnectionSchema } from '../printBridgeConnection';
const now = Date.parse('2026-11-03T12:00:00Z');
test.each(['connected', 'reconnecting', 'disconnected', 'authentication_required'] as const)('shows explicit %s and bounded heartbeat freshness', state => {
  const health = { state, error: null, reportedAt: new Date(now).toISOString() };
  expect(bridgeConnectionSchema.safeParse({ state, error: null }).success).toBe(true);
  expect(bridgeConnectionLabel('active', health, now)).not.toMatch('overdue');
  expect(bridgeConnectionLabel('active', health, now + 91_000)).toMatch('Disconnected');
});
test('legacy identity and recent API activity do not fabricate connected status; revoked pairing requires authentication', () => {
  expect(bridgeConnectionLabel('active', null, now)).toContain('not reported');
  expect(bridgeConnectionLabel('revoked')).toBe('Authentication Required');
  expect(bridgeConnectionSchema.safeParse({ state: 'connected', error: 'raw private exception' }).success).toBe(false);
});
