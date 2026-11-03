import { afterEach, expect, test } from '@jest/globals';
import { gmailAcknowledgementRollout, isGmailAcknowledgementEnabled } from '../services/inboundOrders/inboundGmailAcknowledgementPolicy';

const keys = ['WORKERS_ENABLED','WORKER_INBOUND_GMAIL_ACK_ENABLED','INBOUND_GMAIL_ACK_ORGANIZATION_IDS'];
const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
afterEach(() => { for (const key of keys) if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; });
test.each([
  ['false','true','tenant','global_pause'],
  ['true','false','tenant','worker_pause'],
  ['true',undefined,'tenant','worker_pause'],
  ['true','true','other','tenant_not_enrolled'],
  ['true','true','*','tenant_not_enrolled'],
  ['true','true','tenant',null],
] as const)('explains exact canonical gates: global=%s worker=%s enrollment=%s', (global, worker, organizations, reason) => {
  process.env.WORKERS_ENABLED = global;
  if (worker === undefined) delete process.env.WORKER_INBOUND_GMAIL_ACK_ENABLED; else process.env.WORKER_INBOUND_GMAIL_ACK_ENABLED = worker;
  process.env.INBOUND_GMAIL_ACK_ORGANIZATION_IDS = organizations;
  const status = gmailAcknowledgementRollout('tenant');
  expect(status.reason).toBe(reason);
  expect(status.enabled).toBe(reason === null);
  expect(status.enabled).toBe(isGmailAcknowledgementEnabled('tenant'));
  expect(JSON.stringify(status)).not.toContain('other');
});
