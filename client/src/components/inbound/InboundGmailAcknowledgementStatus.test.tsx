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
beforeEach(()=>{request.mockReset();localStorage.clear();host=document.createElement('div');document.body.append(host);root=createRoot(host);client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});});
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
  const open=await render('reconnect_required');await act(async()=>{[...host.querySelectorAll('button')].find(b=>b.textContent==='Open inbound request')!.click();});expect(open).toHaveBeenCalledWith('record');expect(host.querySelector("a[href='/settings/email']")?.getAttribute('href')).toBe('/settings/email');
});


test('history shows durable Order identity and updated status without offering a completed retry',async()=>{
  await render('succeeded');
  expect(host.textContent).toContain('Gmail updated');
  expect(host.querySelector("a[href='/orders/order']")).not.toBeNull();
  expect([...host.querySelectorAll('button')].some(b=>b.textContent==='Retry Gmail update')).toBe(false);
  await act(async()=>{[...host.querySelectorAll('button')].find(b=>b.textContent==='Show Gmail acknowledgement history')!.click();await new Promise(r=>setTimeout(r,30));});
  expect(request.mock.calls.some(c=>c[1]==='/api/inbound-orders/gmail-acknowledgements?history=true')).toBe(true);
});

const disclosure = () => host.querySelector<HTMLButtonElement>('button[aria-expanded]')!;
const details = () => document.getElementById(disclosure().getAttribute('aria-controls')!)!;
test('defaults collapsed, includes failures, scrolls details, and persists its independent preference',async()=>{
  await render('failed');
  expect(disclosure().getAttribute('aria-expanded')).toBe('false');
  expect(disclosure().textContent).toContain('Paused');
  expect(disclosure().textContent).toContain('1 need attention');
  expect(details().hidden).toBe(true);
  await act(async()=>disclosure().click());
  expect(details().hidden).toBe(false);
  expect(details().className).toContain('max-h-48');
  expect(details().className).toContain('overflow-y-auto');
  expect(localStorage.getItem('titanos.inboundOrders.gmailAcknowledgementsExpanded')).toBe('true');
  await act(async()=>root.unmount());root=createRoot(host);
  await render('waiting');
  expect(disclosure().getAttribute('aria-expanded')).toBe('true');
  await act(async()=>disclosure().click());
  expect(localStorage.getItem('titanos.inboundOrders.gmailAcknowledgementsExpanded')).toBe('false');
});
test('background updates and long lists never reopen collapsed details; totals are not capped by the visible list',async()=>{
  await render('waiting');
  const data={enabled:false,counts:{pending:140,failed:3},jobs:Array.from({length:100},(_,i)=>({id:`job-${i}`,orderId:`order-${i}`,orderNumber:`QA-${i}`,inboundRecordId:'record',mailboxId:'mailbox',status:'waiting',canRetry:false}))};
  await act(async()=>{client.setQueryData(['/api/inbound-orders/gmail-acknowledgements',false],data);await new Promise(r=>setTimeout(r,20));});
  expect(disclosure().textContent).toContain('140 pending');
  expect(disclosure().textContent).toContain('3 need attention');
  expect(details().hidden).toBe(true);
  await act(async()=>disclosure().click());
  expect(details().textContent).toContain('Order QA-99');
  await act(async()=>{client.setQueryData(['/api/inbound-orders/gmail-acknowledgements',false],{...data,counts:{pending:139,failed:4}});await new Promise(r=>setTimeout(r,20));});
  expect(disclosure().getAttribute('aria-expanded')).toBe('true');
});

test('unavailable status remains discoverable without claiming zero pending updates',async()=>{
  request.mockRejectedValue(new Error('Synthetic unavailable status'));
  await act(async()=>{root.render(<QueryClientProvider client={client}><InboundGmailAcknowledgementStatus onOpenRecord={jest.fn()}/></QueryClientProvider>);await new Promise(r=>setTimeout(r,30));});
  await act(async()=>{await new Promise(r=>setTimeout(r,30));});
  expect(disclosure().textContent).toContain('Status unavailable');expect(disclosure().textContent).toContain('Counts unavailable');
  expect(host.textContent).not.toContain('No pending Gmail updates.');
});
