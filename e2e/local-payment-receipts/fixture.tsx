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
import '../../client/src/index.css';

const receipt=projectPaymentReceipt({id:'batch-synthetic-500',batchId:'synthetic-500',creditId:null,paymentId:null,appliedAt:'2026-06-15T14:30:00Z',amountCents:50000,retainedCents:50000,method:'other',provider:'manual',status:'succeeded',reference:'CashApp-500-REF',notes:'Cash App receipt',customerId:'synthetic-customer',customerName:'Synthetic Buyer',linkageWarning:null,allocations:[20000,17500,12500].map((amountCents,i)=>({paymentId:`synthetic-payment-${i}`,invoiceId:`synthetic-invoice-${i}`,invoiceNumber:`INV-${['A','B','C'][i]}`,amountCents,status:'succeeded',reference:null,orderId:null,orderNumber:null,jobName:null}))});
window.fetch=async(input,init)=>{
 const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,location.origin);
 const query=url.searchParams.get('search')?.toLowerCase();const rows=!query||JSON.stringify(receipt).toLowerCase().includes(query)||query.replace('$','')==='500.00'?[receipt]:[];
 const raw=(data:unknown)=>new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
 if(url.pathname==='/api/auth/session')return raw({authenticated:true,user:{id:'synthetic-staff',organizationId:'fixture',role:'employee'}});
 if(url.pathname==='/api/customers')return raw({data:{customers:[{id:'synthetic-customer',companyName:'Synthetic Buyer'}],pagination:{page:1,total:1}}});
 if(url.pathname.endsWith('/transactions'))return raw({rows:rows.map(receipt=>({id:receipt.id,date:receipt.appliedAt,type:'payment',referenceNumber:receipt.reference,description:receipt.notes,status:receipt.status,amount:'500.00',method:receipt.method,linkId:null,linkType:null,receipt})),summary:{invoicedTotal:'500.00',paidTotal:'500.00',refundedTotal:'0',openBalance:'0',creditsTotal:'0'},pagination:{total:rows.length,page:1,pageSize:50,totalPages:1,hasNextPage:false,hasPreviousPage:false}});
 if(url.pathname==='/api/payments')return raw({success:true,data:{rows,summary:{totalPayments:rows.length,totalCollectedCents:rows.length?50000:0},pagination:{page:1,pageSize:50,totalCount:rows.length,totalPages:1},timezone:'America/New_York'}});
 return raw({success:true,data:[]});
};
function Fixture(){const {setTheme}=useTheme();const location=useLocation();return <><div className="flex gap-4 border-b bg-background p-2 text-sm text-foreground"><span>Synthetic payment history · mocked API</span><Link to="/transactions">Customer Transactions</Link><Link to="/payments">Global Payments</Link><button onClick={()=>setTheme('light')}>Light</button><button onClick={()=>setTheme('dark')}>Dark</button></div>{location.pathname==='/payments'?<FinancePage/>:<div className="p-4"><TransactionsTab customerId="synthetic-customer" customer={{companyName:'Synthetic Buyer'} as any}/></div>}</>}
createRoot(document.getElementById('root')!).render(<ThemeProvider><QueryClientProvider client={queryClient}><BrowserRouter><TooltipProvider><Fixture/></TooltipProvider></BrowserRouter></QueryClientProvider></ThemeProvider>);
