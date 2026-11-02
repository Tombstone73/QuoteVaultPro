import { test } from '@jest/globals';
import { InboundEmailProcessingWorker } from '../../services/inboundOrders/InboundEmailProcessingWorker';
import { InboundOrderParsingService } from '../../services/inboundOrders/InboundOrderParsingService';
import { inboundOrdersRepository } from '../../storage/inboundOrders.repo';
import { inboundEmailProcessingRepository } from '../../storage/inboundEmailProcessing.repo';
import { InboundOrderService } from '../../services/inboundOrders/InboundOrderService';

test('disposable worker interruption boundary', async () => {
  if (process.env.INBOUND_TEST_CRASH_CHILD !== 'true') throw new Error('Only the isolated parent test may run this child.');
  const parser = new InboundOrderParsingService(inboundOrdersRepository, () => ({
    generateJson: async () => {
      process.stdout.write('INBOUND_TEST_PROVIDER_ENTERED\n');
      return new Promise(() => {}); // Parent terminates this real worker process.
    },
  } as any), { buildEvidenceBundle: async () => ({ items: [], conflicts: [] }) } as any);
  await new InboundEmailProcessingWorker(inboundEmailProcessingRepository, inboundOrdersRepository, parser,
    new InboundOrderService(inboundOrdersRepository), { getSettings: async () => ({ inboundEmailIntakeEnabled: true }) } as any).runOnce(1);
}, 60000);
