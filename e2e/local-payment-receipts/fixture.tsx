import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, useLocation } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider, useTheme } from '@/hooks/useTheme';
import { TooltipProvider } from '@/components/ui/tooltip';
import { queryClient } from '@/lib/queryClient';
import TransactionsTab from '@/features/customers/TransactionsTab';
import FinancePage from '@/pages/finance';
import { projectPaymentReceipt } from '@shared/paymentReceiptHistory';
import { allocateCustomerPayment } from '@shared/customerPaymentAllocation';
import { MultiInvoicePaymentDialog } from '@/components/invoices/MultiInvoicePaymentDialog';
import '../../client/src/index.css';

const receipt=projectPaymentReceipt({id:'batch-synthetic-500',batchId:'synthetic-500',creditId:null,paymentId:null,appliedAt:'2026-06-15T14:30:00Z',amountCents:50000,retainedCents:50000,method:'other',provider:'manual',status:'succeeded',reference:'CashApp-500-REF',notes:'Cash App receipt',customerId:'synthetic-customer',customerName:'Synthetic Buyer',linkageWarning:null,allocations:[20000,17500,12500].map((amountCents,i)=>({paymentId:`synthetic-payment-${i}`,invoiceId:`synthetic-invoice-${i}`,invoiceNumber:`INV-${['A','B','C'][i]}`,amountCents,status:'succeeded',reference:null,orderId:null,orderNumber:null,jobName:null}))});
const selectedInvoices=[20000,17500,10000].map((remainingCents,i)=>({invoiceId:`entry-${i}`,invoiceNumber:i+1,invoiceDisplayNumber:`INV-${['A','B','C'][i]}`,remainingCents,dueDate:`2026-06-0${i+1}`}));
const fixtureState={posts:[] as Array<{body:any;key:string|null}>,failNext:false};
(window as any).paymentEntryFixture=fixtureState;
window.fetch=async(input,init)=>{
 const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,location.origin);
 const query=url.searchParams.get('search')?.toLowerCase();const rows=!query||JSON.stringify(receipt).toLowerCase().includes(query)||query.replace('$','')==='500.00'?[receipt]:[];
 const raw=(data:unknown)=>new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
 if(url.pathname==='/api/me/orgs')return raw({organizations:[{id:'fixture',role:'admin'}],activeOrganizationId:'fixture'});
 if(url.pathname==='/api/invoices/customer-payment/stripe/runtime-config')return new Response(JSON.stringify({code:'STRIPE_SERVER_NOT_CONFIGURED',error:'Synthetic fixture has no gateway.'}),{status:409,headers:{'Content-Type':'application/json'}});
 if(url.pathname==='/api/invoices/customer-payment/preview'){
  const body=JSON.parse(String(init?.body));return raw({data:{customerId:'synthetic-customer',customerName:'Synthetic Buyer',selectedCount:3,eligibleCount:3,excludedCount:0,totalOutstandingCents:47500,invoices:selectedInvoices,allocations:allocateCustomerPayment({invoices:selectedInvoices,amountCents:Math.min(body.amountCents,47500),mode:body.allocationMode})}});
 }
 if(url.pathname==='/api/invoices/customer-payment'){
  const body=JSON.parse(String(init?.body));fixtureState.posts.push({body,key:new Headers(init?.headers).get('Idempotency-Key')});
  if(fixtureState.failNext){fixtureState.failNext=false;return new Response(JSON.stringify({error:'Synthetic connection failure: review and retry.'}),{status:503,headers:{'Content-Type':'application/json'}});}
  return raw({data:{appliedAmountCents:Math.min(body.amountCents,47500),changeDueCents:Math.max(0,body.amountCents-47500)}});
 }
 if(url.pathname==='/api/auth/session')return raw({authenticated:true,user:{id:'synthetic-staff',organizationId:'fixture',role:'employee'}});
 if(url.pathname==='/api/customers')return raw({data:{customers:[{id:'synthetic-customer',companyName:'Synthetic Buyer'}],pagination:{page:1,total:1}}});
 if(url.pathname.endsWith('/transactions'))return raw({rows:rows.map(receipt=>({id:receipt.id,date:receipt.appliedAt,type:'payment',referenceNumber:receipt.reference,description:receipt.notes,status:receipt.status,amount:'500.00',method:receipt.method,linkId:null,linkType:null,receipt})),summary:{invoicedTotal:'500.00',paidTotal:'500.00',refundedTotal:'0',openBalance:'0',creditsTotal:'0'},pagination:{total:rows.length,page:1,pageSize:50,totalPages:1,hasNextPage:false,hasPreviousPage:false}});
 if(url.pathname==='/api/payments')return raw({success:true,data:{rows,summary:{totalPayments:rows.length,totalCollectedCents:rows.length?50000:0},pagination:{page:1,pageSize:50,totalCount:rows.length,totalPages:1},timezone:'America/New_York'}});
 return raw({success:true,data:[]});
};
function Entry(){const [open,setOpen]=React.useState(false);return <div className="p-4 text-foreground"><button onClick={()=>setOpen(true)}>Receive payment</button><MultiInvoicePaymentDialog open={open} onOpenChange={setOpen} invoiceIds={['entry-0','entry-1','entry-2']} onSuccess={()=>{}}/></div>}
function Fixture(){const {setTheme}=useTheme();const location=useLocation();return <><div className="flex gap-4 border-b bg-background p-2 text-sm text-foreground"><span>Synthetic payments · mocked API/persistence</span><Link to="/transactions">Customer Transactions</Link><Link to="/payments">Global Payments</Link><Link to="/entry">Payment Entry</Link><button onClick={()=>setTheme('light')}>Light</button><button onClick={()=>setTheme('dark')}>Dark</button></div>{location.pathname==='/entry'?<Entry/>:location.pathname==='/payments'?<FinancePage/>:<div className="p-4"><TransactionsTab customerId="synthetic-customer" customer={{companyName:'Synthetic Buyer'} as any}/></div>}</>}
createRoot(document.getElementById('root')!).render(<ThemeProvider><QueryClientProvider client={queryClient}><BrowserRouter><TooltipProvider><Fixture/></TooltipProvider></BrowserRouter></QueryClientProvider></ThemeProvider>);
