/// <reference types="jest" />
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { InboundEmailImportStatus } from './InboundEmailImportStatus';
import { inboundEmailImportLabels, type InboundEmailImportStatus as Status } from '@shared/inboundEmailImport';

jest.mock('@/lib/queryClient',()=>({apiRequest:jest.fn()}));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
let container:HTMLDivElement,root:Root,client:QueryClient;
const request=apiRequest as jest.Mock;
beforeEach(()=>{request.mockReset();container=document.createElement('div');document.body.append(container);root=createRoot(container);client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});});
afterEach(()=>{act(()=>root.unmount());client.clear();container.remove();});
async function render(status:Status,open=jest.fn()){
  request.mockResolvedValue({json:async()=>({success:true,data:{enabled:false,jobs:[{id:'import-job',workKind:'message',mailboxId:'mailbox',inboundRecordId:'record',status,attempts:1,
    nextAttemptAt:'2026-11-01T00:00:00Z',message:'Evidence retained.',errorCode:null,canRetry:['failed','needs_attention'].includes(status)}]}})});
  await act(async()=>{root.render(<QueryClientProvider client={client}><InboundEmailImportStatus onOpenRecord={open}/></QueryClientProvider>);});
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,20));});return open;
}
test.each(['waiting','importing','retrying','needs_attention','failed'] as const)('shows %s separately from AI preparation and business disposition',async status=>{
  await render(status);expect(container.textContent).toContain(inboundEmailImportLabels[status]);
  expect(container.textContent).toContain('incomplete review draft');expect(container.textContent).toContain('Background import recovery is paused');
  expect(container.textContent).toContain('cannot run until recovery resumes');
  expect(request.mock.calls.every(call=>call[0]==='GET')).toBe(true);
});
test('staff retry queues exactly one retained import without starting provider work in the browser',async()=>{
  await render('failed');const retry=[...container.querySelectorAll('button')].find(button=>button.textContent==='Queue import retry')!;
  await act(async()=>{retry.click();await new Promise(resolve=>setTimeout(resolve,20));});
  expect(request.mock.calls.filter(call=>call[0]==='POST')).toEqual([['POST','/api/inbound-orders/email-imports/import-job/retry',{}]]);
});
test('opens the exact linked inbound record',async()=>{
  const open=await render('needs_attention');
  await act(async()=>{[...container.querySelectorAll('button')].find(button=>button.textContent==='Open inbound request')!.click();});
  expect(open).toHaveBeenCalledWith('record');
});
test('completion refreshes source/list queries while preserving unsaved review edits',async()=>{
  const key=['/api/inbound-orders','record','review-draft'];const edits={notes:'Keep unsaved staff edits'};
  client.setQueryData(key,edits);await render('importing');
  const invalidation=jest.spyOn(client,'invalidateQueries');
  await act(async()=>{client.setQueryData(['/api/inbound-orders/email-imports'],{success:true,data:{enabled:false,jobs:[]}});await new Promise(resolve=>setTimeout(resolve,20));});
  expect(client.getQueryData(key)).toEqual(edits);expect(client.getQueryState(key)?.isInvalidated).toBe(false);
  expect(invalidation).toHaveBeenCalledWith({queryKey:['/api/inbound-orders','record'],exact:true});
});
