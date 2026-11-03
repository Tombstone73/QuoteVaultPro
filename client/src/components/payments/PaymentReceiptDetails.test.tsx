import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { TextEncoder, TextDecoder } from 'node:util';
import { expect, jest, test } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { projectPaymentReceipt, type PaymentReceipt } from '@shared/paymentReceiptHistory';

Object.assign(globalThis,{TextEncoder,TextDecoder,IS_REACT_ACT_ENVIRONMENT:true});
const {MemoryRouter}=require('react-router-dom');
jest.mock('@/lib/queryClient',()=>({apiFetch:(...args:any[])=>(fetch as any)(...args)}));
jest.mock('@/components/CustomerSelect',()=>({CustomerSelect:()=> <div>Customer filter</div>}));
const {PaymentReceiptDetails}=require('./PaymentReceiptDetails');
const {default:FinancePage}=require('@/pages/finance');
const {default:TransactionsTab}=require('@/features/customers/TransactionsTab');
const receipt=projectPaymentReceipt({id:'batch-receipt',batchId:'receipt',creditId:null,paymentId:null,appliedAt:'2026-06-15T14:30:00Z',amountCents:50000,retainedCents:50000,method:'other',provider:'manual',status:'succeeded',reference:'CashApp-REF',notes:'Cash App',customerId:'customer-1',customerName:'Test Buyer',linkageWarning:null,allocations:[20000,17500,12500].map((amountCents,i)=>({paymentId:`payment-${i}`,invoiceId:`invoice-${i}`,invoiceNumber:`INV-${i}`,amountCents,status:'succeeded',reference:null,orderId:null,orderNumber:null,jobName:null}))});
const history={rows:[receipt],summary:{totalPayments:1,totalCollectedCents:50000},pagination:{page:1,pageSize:50,totalCount:1,totalPages:1},timezone:'America/New_York'};
const transactions={rows:[{id:receipt.id,date:receipt.appliedAt,type:'payment',referenceNumber:receipt.reference,description:receipt.notes,status:'succeeded',amount:'500.00',method:'other',linkId:null,linkType:null,receipt}],summary:{invoicedTotal:'500.00',paidTotal:'500.00',refundedTotal:'0',openBalance:'0',creditsTotal:'0'},pagination:{total:1,page:1,pageSize:50,totalPages:1,hasNextPage:false,hasPreviousPage:false}};
async function mount(content:React.ReactNode){const client=new QueryClient({defaultOptions:{queries:{retry:false}}});const host=document.createElement('div');document.body.append(host);const root=createRoot(host);await act(async()=>root.render(<MemoryRouter><QueryClientProvider client={client}>{content}</QueryClientProvider></MemoryRouter>));await act(async()=>{await new Promise(resolve=>setTimeout(resolve,25));});return {host,close:()=>{act(()=>root.unmount());client.clear();host.remove();}};}

test('shared receipt disclosure has one original amount, canonical invoice links and allocation statuses',async()=>{const view=await mount(<PaymentReceiptDetails receipt={receipt}/>);try{expect(view.host.querySelector('details')!.open).toBe(false);expect(view.host.querySelector('summary')!.textContent).toContain('3 invoice allocations');expect(view.host.querySelectorAll('a')).toHaveLength(3);expect(view.host.querySelector('a')!.getAttribute('href')).toBe('/invoices/invoice-0');expect(view.host.textContent).toContain('$200.00');expect(view.host.textContent).toContain('$175.00');expect(view.host.textContent).toContain('$125.00');expect(view.host.textContent).toContain('Unapplied: $0.00');}finally{view.close();}});

test('linked partial refund retains one invoice count and does not invent unapplied money',async()=>{
 const original=receipt.allocations[0];
 const value=projectPaymentReceipt({...receipt,amountCents:20000,retainedCents:20000,allocations:[original,{...original,paymentId:'refund',status:'refunded',originalPaymentId:original.paymentId,amountCents:2500}]});
 const view=await mount(<PaymentReceiptDetails receipt={value}/>);
 try{expect(view.host.querySelector('summary')!.textContent).toBe('1 invoice allocation · $200.00 allocated · $25.00 refunded');expect(view.host.textContent).toContain('Unapplied: $0.00');expect(view.host.textContent).not.toContain('Requires review');expect(view.host.querySelectorAll('a')).toHaveLength(2);}finally{view.close();}
});

test.each(['customer','global'])('%s history uses the shared grouped disclosure and server totals',async screen=>{global.fetch=jest.fn<typeof fetch>().mockResolvedValue({ok:true,json:async()=>screen==='customer'?transactions:{success:true,data:history}} as Response);const view=await mount(screen==='customer'?<TransactionsTab customerId="customer-1" customer={{companyName:'Test Buyer'} as any}/>:<FinancePage/>);try{expect(view.host.querySelectorAll('details')).toHaveLength(1);expect(view.host.querySelectorAll('details a')).toHaveLength(3);expect(view.host.textContent).toContain('CashApp-REF');expect(view.host.textContent).toContain('$500.00');expect(view.host.querySelector('summary')!.textContent).toContain('$500.00 allocated');expect(view.host.querySelector('button')?.disabled).not.toBe(true);}finally{view.close();}});

test.each([
 {...receipt,amountCents:55000},
 {...receipt,unappliedCents:10000},
 {...receipt,refundedCents:10000},
 {...receipt,linkageWarning:'Original receipt linkage requires review',unappliedCents:null},
])('remainder/refund/change/ambiguous history stays visible without any mutation controls',async value=>{const view=await mount(<PaymentReceiptDetails receipt={value}/>);try{expect(view.host.querySelectorAll('button')).toHaveLength(0);expect(view.host.textContent).toContain(value.amountCents>value.retainedCents?'Returned change':value.refundedCents?'Refund entries':value.linkageWarning?'Requires review':'Unapplied: $100.00');}finally{view.close();}});
