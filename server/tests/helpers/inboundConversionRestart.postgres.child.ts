import { afterAll, expect, test } from '@jest/globals';
import { InboundOrderService } from '../../services/inboundOrders/InboundOrderService';
import { inboundOrdersRepository } from '../../storage/inboundOrders.repo';
import { inboundOrderReviewDraftSaveSchema } from '@shared/inboundOrdersApi';
import { pool } from '../../db';

afterAll(async () => { await pool.end(); });
test('a fresh server process returns the durable existing Order for the original stale submission', async () => {
  if (process.env.INBOUND_TEST_CONVERSION_CHILD !== 'true') throw new Error('Only the disposable PostgreSQL parent may run this child.');
  const input = JSON.parse(process.env.INBOUND_TEST_CONVERSION_INPUT ?? '{}');
  const result = await new InboundOrderService(inboundOrdersRepository).createOrderFromReviewDraft({
    organizationId: input.organizationId, inboundRecordId: input.inboundRecordId, actorUserId: input.actorUserId,
    draft: inboundOrderReviewDraftSaveSchema.parse(input.draft),
  });
  expect(result.orderId).toBe(input.expectedOrderId);
  expect(result.alreadyConverted).toBe(true);
  process.stdout.write('INBOUND_CONVERSION_RESTART_VERIFIED\n');
}, 20000);
