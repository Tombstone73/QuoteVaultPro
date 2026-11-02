import { test } from '@jest/globals';
import { InboundEmailIngestionService } from '../../services/inboundEmailIngestionService';

test('isolated import worker interruption boundary', async () => {
  if (process.env.INBOUND_IMPORT_CRASH_CHILD !== 'true') throw new Error('Only the isolated import test may run this child.');
  const message = JSON.parse(process.env.INBOUND_IMPORT_SYNTHETIC_MESSAGE!);
  message.receivedAt = new Date(message.receivedAt);
  const adapter = {
    listRecentMessages: async () => { throw new Error('Recovery must not discover messages again'); },
    getMessage: async () => message,
    downloadAttachment: async () => {
      process.stdout.write('INBOUND_IMPORT_DOWNLOAD_ENTERED\n');
      return new Promise<never>(() => {});
    },
  };
  await new InboundEmailIngestionService(undefined, { gmail: adapter }).recoverInterruptedImports(1);
}, 60000);
