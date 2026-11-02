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
beforeEach(()=>{request.mockReset();window.localStorage.clear();container=document.createElement('div');document.body.append(container);root=createRoot(container);client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});});
afterEach(()=>{act(()=>root.unmount());client.clear();container.remove();});
async function render(status:Status,open=jest.fn()){
  request.mockResolvedValue({json:async()=>({success:true,data:{enabled:false,jobs:[{id:'import-job',workKind:'message',mailboxId:'mailbox',inboundRecordId:'record',status,attempts:1,
    nextAttemptAt:'2026-11-01T00:00:00Z',message:'Evidence retained.',errorCode:null,canRetry:['failed','needs_attention'].includes(status)}]}})});
  await act(async()=>{root.render(<QueryClientProvider client={client}><InboundEmailImportStatus onOpenRecord={open}/></QueryClientProvider>);});
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,20));});return open;
}
const disclosure = () => container.querySelector('button[aria-expanded]') as HTMLButtonElement;
const details = () => document.getElementById(disclosure().getAttribute('aria-controls')!) as HTMLDivElement;
async function expand() { await act(async () => { disclosure().click(); }); }
test.each(['waiting','importing','retrying','needs_attention','failed'] as const)('shows %s separately from AI preparation and business disposition',async status=>{
  await render(status);expect(disclosure().getAttribute('aria-expanded')).toBe('false');
  expect(details().hidden).toBe(true);
  expect(disclosure().textContent).toContain('Paused');
  await expand();expect(details().hidden).toBe(false);
  expect(container.textContent).toContain(inboundEmailImportLabels[status]);
  expect(container.textContent).toContain('incomplete review draft');expect(container.textContent).toContain('Background import recovery is paused');
  expect(container.textContent).toContain('cannot run until recovery resumes');
  expect(request.mock.calls.every(call=>call[0]==='GET')).toBe(true);
});
test('staff retry queues exactly one retained import without starting provider work in the browser',async()=>{
  await render('failed');await expand();const retry=[...container.querySelectorAll('button')].find(button=>button.textContent==='Queue import retry')!;
  await act(async()=>{retry.click();await new Promise(resolve=>setTimeout(resolve,20));});
  expect(request.mock.calls.filter(call=>call[0]==='POST')).toEqual([['POST','/api/inbound-orders/email-imports/import-job/retry',{}]]);
});
test('opens the exact linked inbound record',async()=>{
  const open=await render('needs_attention');await expand();
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

test('long import progress stays collapsed, summarizes warnings, and caps expanded detail height', async () => {
  const jobs = Array.from({ length: 24 }, (_, index) => ({
    id: `job-${index}`, workKind: 'message', mailboxId: 'mailbox', inboundRecordId: `record-${index}`,
    status: index < 5 ? 'needs_attention' : index < 7 ? 'failed' : 'complete', attempts: 1,
    nextAttemptAt: '2026-11-01T00:00:00Z', message: `Retained import ${index}`, errorCode: null, canRetry: index < 7,
  }));
  request.mockResolvedValue({ json: async () => ({ success: true, data: { enabled: false, jobs } }) });
  await act(async () => { root.render(<QueryClientProvider client={client}><InboundEmailImportStatus /></QueryClientProvider>); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  expect(disclosure().textContent).toContain('Paused · 5 need attention · 2 failed');
  expect(disclosure().getAttribute('aria-expanded')).toBe('false');
  expect(details().hidden).toBe(true);
  await expand();
  expect(details().className).toContain('max-h-48');
  expect(details().className).toContain('overflow-y-auto');
  expect(details().querySelectorAll('[role="status"]')).toHaveLength(24);
  await expand();
  expect(details().hidden).toBe(true);
});

test('saved expansion survives remount; background updates change summary without reopening', async () => {
  await render('needs_attention');
  await expand();
  expect(window.localStorage.getItem('titanos.inboundOrders.emailImportExpanded')).toBe('true');
  await act(async () => { root.unmount(); });
  root = createRoot(container);
  await act(async () => { root.render(<QueryClientProvider client={client}><InboundEmailImportStatus /></QueryClientProvider>); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  expect(disclosure().getAttribute('aria-expanded')).toBe('true');
  await expand();
  await act(async () => {
    client.setQueryData(['/api/inbound-orders/email-imports'], { success: true, data: { enabled: true, jobs: [{
      id: 'import-job', workKind: 'message', mailboxId: 'mailbox', inboundRecordId: 'record', status: 'failed', attempts: 2,
      nextAttemptAt: '2026-11-01T00:00:00Z', message: 'New failure', errorCode: null, canRetry: true,
    }] } });
    await new Promise(resolve => setTimeout(resolve, 20));
  });
  expect(disclosure().textContent).toContain('Recovery active · 1 failed');
  expect(disclosure().getAttribute('aria-expanded')).toBe('false');
  expect(details().hidden).toBe(true);
  expect(window.localStorage.getItem('titanos.inboundOrders.emailImportExpanded')).toBe('false');
});

test('dismissal refresh clears actionable counts, keeps collapse preference and exposes read-only history', async () => {
  await render('needs_attention');
  await act(async () => { client.setQueryData(['/api/inbound-orders/email-imports'], {success:true,data:{enabled:false,jobs:[]}}); await new Promise(resolve=>setTimeout(resolve,20)); });
  expect(disclosure().textContent).toContain('No actionable import issues');
  expect(disclosure().getAttribute('aria-expanded')).toBe('false');
  await expand();
  request.mockResolvedValue({json:async()=>({success:true,data:{enabled:false,jobs:[
    {id:'dismissed',workKind:'message',status:'skipped',errorCode:'IMPORT_DISMISSED',inboundRecordId:'record',canRetry:false},
    {id:'complete',workKind:'message',status:'complete',inboundRecordId:'record',canRetry:false},
    {id:'actual-failure',workKind:'message',status:'failed',inboundRecordId:'other',canRetry:true},
  ]}})});
  await act(async()=>{[...container.querySelectorAll('button')].find(button=>button.textContent==='Show import history')!.click(); await new Promise(resolve=>setTimeout(resolve,40));});
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,20));});
  expect(request).toHaveBeenCalledWith('GET','/api/inbound-orders/email-imports?history=true');
  expect(disclosure().textContent).toContain('1 failed');
  expect(disclosure().textContent).not.toContain('need attention');
  expect(container.textContent).toContain('Dismissed by staff · Not an order');
  expect(container.textContent).toContain('Email evidence imported');
  expect(container.textContent).toContain('Prior failures and superseded attempts remain');
  expect([...container.querySelectorAll('button')].filter(button=>button.textContent==='Queue import retry')).toHaveLength(1);
  expect(disclosure().getAttribute('aria-expanded')).toBe('true');
  expect(request.mock.calls.every(call=>call[0]==='GET')).toBe(true);
});
