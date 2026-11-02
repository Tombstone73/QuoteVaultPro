import { test } from '@jest/globals';
import { InboundGmailAcknowledgementWorker } from '../../services/inboundOrders/InboundGmailAcknowledgementWorker';
test('isolated acknowledgement crash boundary',async()=>{
  if(process.env.INBOUND_ACK_CRASH_CHILD!=='true')throw new Error('Only isolated acknowledgement suite may run this child');
  await new InboundGmailAcknowledgementWorker(undefined,{acknowledge:async(_mailbox,_ids,guard)=>{
    await guard();process.stdout.write('ACK_REMOTE_APPLIED\n');return new Promise<never>(()=>{});
  }}).runOnce(1);
},60000);
