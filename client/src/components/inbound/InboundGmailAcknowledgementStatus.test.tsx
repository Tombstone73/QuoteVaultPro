/// <reference types="jest" />
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { InboundGmailAcknowledgementStatus } from './InboundGmailAcknowledgementStatus';
import { gmailAcknowledgementLabels, type GmailAcknowledgementStatus } from '@shared/inboundGmailAcknowledgement';
jest.mock('@/lib/queryClient',()=>({apiRequest:jest.fn()}));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
let root:Root,host:HTMLDivElement,client:QueryClient;
const request=apiRequest as jest.Mock;
beforeEach(()=>{request.mockReset();host=document.createElement('div');document.body.append(host);root=createRoot(host);client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});});
afterEach(()=>{act(()=>root.unmount());client.clear();host.remove();});
async function render(status:GmailAcknowledgementStatus){
  const open=jest.fn();request.mockResolvedValue({json:async()=>({enabled:false,jobs:[{id:'ack',inboundRecordId:'record',orderId:'order',mailboxId:'mailbox',status,message:'Order unchanged',canRetry:['failed','reconnect_required'].includes(status)}]})});
  await act(async()=>{root.render(<QueryClientProvider client={client}><InboundGmailAcknowledgementStatus onOpenRecord={open}/></QueryClientProvider>);await new Promise(r=>setTimeout(r,20));});
  await act(async()=>{await new Promise(r=>setTimeout(r,20));});return open;
}
test.each(['waiting','processing','retrying','reconnect_required','failed','needs_attention'] as const)('shows %s separately from business disposition',async status=>{
  await render(status);expect(host.textContent).toContain(gmailAcknowledgementLabels[status]);expect(host.textContent).toContain('Gmail writes are paused');expect(host.textContent).toContain('separate from Order creation');expect(request.mock.calls.every(c=>c[0]==='GET')).toBe(true);
});
test('retry only queues acknowledgement once and never invalidates an editable draft',async()=>{
  const draftKey=['/api/inbound-orders','record','review-draft'];client.setQueryData(draftKey,{notes:'Unsaved edit'});await render('failed');
  await act(async()=>{[...host.querySelectorAll('button')].find(b=>b.textContent==='Retry Gmail update')!.click();await new Promise(r=>setTimeout(r,20));});
  expect(request.mock.calls.filter(c=>c[0]==='POST')).toEqual([['POST','/api/inbound-orders/gmail-acknowledgements/ack/retry',{}]]);expect(client.getQueryState(draftKey)?.isInvalidated).toBe(false);
});
test('opens the exact inbound record and gives reconnect access without starting OAuth',async()=>{
  const open=await render('reconnect_required');await act(async()=>{[...host.querySelectorAll('button')].find(b=>b.textContent==='Open inbound request')!.click();});expect(open).toHaveBeenCalledWith('record');expect(host.querySelector('a')?.getAttribute('href')).toBe('/settings/email');
});
