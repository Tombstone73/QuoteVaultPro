import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CloseJobOverrideDialog } from '@/components/orders/CloseJobOverrideDialog';
import { useToast } from '@/hooks/use-toast';
import '@/index.css';

const initial = () => ({ orderState: 'production_complete', orderStatus: 'ready_for_shipment', fulfillmentStatus: 'pending',
  physicalLineCount: 3, remainingProductionQuantity: 8, remainingFulfillmentQuantity: 8, productionComplete: false,
  alreadyOperationallyComplete: false, productionStarted: true, activeProductionJobCount: 1, productionConflicts: [],
  requiresProductionBootstrap: true, productionBootstrapLineCount: 2, requiresParentProductionRecovery: true, canCloseJobOverride: true,
  previewToken: 'a'.repeat(64), productionBootstrapLines: [
    { lineItemId: 'synthetic-2', lineNumber: 2, description: 'Synthetic vinyl', quantity: 3, ownershipState: 'needs_bootstrap', reason: 'Required production has no active owner.' },
    { lineItemId: 'synthetic-3', lineNumber: 3, description: 'Synthetic backer', quantity: 5, ownershipState: 'needs_bootstrap', reason: 'Required production has no active owner.' },
  ],
});
let preview=initial(), mode='success', mutations=0;
const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
window.fetch=async(input,init)=>{
  const url=new URL(typeof input==='string'?input:input instanceof Request?input.url:input.toString(),location.origin);
  if(url.origin!==location.origin || !url.pathname.startsWith('/api/orders/synthetic/')) throw new Error('Fixture blocks nonlocal/business requests');
  if(init?.method!=='POST') return Response.json({success:true,data:preview});
  mutations++;
  if(mode==='rejected')return Response.json({success:false,code:'PRODUCTION_BOOTSTRAP_REVIEW_REQUIRED',message:'Review terminal production history before retrying; no changes committed.'},{status:409});
  if(url.pathname.endsWith('/complete-production')) {
    preview={...preview,productionComplete:true,remainingProductionQuantity:0,activeProductionJobCount:0,requiresProductionBootstrap:false,productionBootstrapLines:[],previewToken:'b'.repeat(64)};
    return Response.json({success:true,nextPreviewToken:preview.previewToken,data:{id:'synthetic'}});
  }
  preview={...preview,remainingFulfillmentQuantity:0,alreadyOperationallyComplete:true,canCloseJobOverride:false};
  if(mode==='lost')throw new TypeError('Synthetic response lost after commit');
  return Response.json({success:true,data:{alreadyCompleted:false}});
};
function Fixture(){
  const [open,setOpen]=useState(false),[dark,setDark]=useState(false);
  const {toasts}=useToast();
  return <main className="min-h-screen bg-background p-6 text-foreground">
    <h1>Close Job — synthetic browser fixture</h1><p>Mocked APIs only. No real Orders, files, invoices or payments.</p>
    <label>Scenario <select onChange={event=>{mode=event.target.value;preview=initial();client.clear();}}><option value="success">Success</option><option value="rejected">Rejected ownership</option><option value="lost">Response lost after commit</option></select></label>
    <button className="m-3 rounded border px-3 py-2" onClick={()=>{setDark(!dark);document.documentElement.classList.toggle('dark',!dark);}}>Toggle theme</button>
    <button className="rounded border px-3 py-2" onClick={()=>setOpen(true)}>Open synthetic override</button>
    <output>Mutation requests: {mutations}</output>
    <CloseJobOverrideDialog target={open?{orderId:'synthetic',orderNumber:'QA-20779',customerName:'Synthetic customer',jobStatus:'Complete'}:null} onOpenChange={setOpen}/>
    <section aria-label="Notifications">{toasts.map(item=><p key={item.id} role="status">{item.title} · {item.description}</p>)}</section>
  </main>;
}
createRoot(document.getElementById('root')!).render(<BrowserRouter><QueryClientProvider client={client}><Fixture/></QueryClientProvider></BrowserRouter>);
