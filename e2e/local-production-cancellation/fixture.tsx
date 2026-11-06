import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/lib/queryClient';
import { ThemeProvider, useTheme } from '@/hooks/useTheme';
import { TooltipProvider } from '@/components/ui/tooltip';
import { NavigationGuardProvider } from '@/contexts/NavigationGuardContext';
import { OrderStatusPillSelector } from '@/components/OrderStatusPillSelector';
import { OrderLineItemsSection } from '@/components/orders/OrderLineItemsSection';
import { useToast } from '@/hooks/use-toast';
import type { OrderLineItem } from '@shared/schema';
import '@/index.css';

const line = { id:'synthetic-line',orderId:'synthetic-order',productId:'synthetic-product',description:'Synthetic Window Perf',
  quantity:2,width:24,height:36,unitPrice:'10',totalPrice:'20',status:'in_production',workflowState:'in_production',
  sortOrder:0,requiresProductionJob:true,requiresPrepress:false,requiresDesign:false,requiresProofApproval:false,
  productType:'wide_roll',selectedOptions:[],specsJson:{},createdAt:new Date(),updatedAt:new Date() } as unknown as OrderLineItem;
const pill = {id:'synthetic-complete',organizationId:'synthetic-org',stateScope:'open',key:'complete',name:'Complete',color:'#2563eb',isActive:true,isDefault:false,sortOrder:0};
let mutations=0;
const originalFetch=window.fetch.bind(window);
window.fetch=async(input,init)=>{
 const url=new URL(typeof input==='string'?input:input instanceof Request?input.url:input.toString(),location.origin);
 if(url.origin!==location.origin)throw new Error('Synthetic fixture blocks external requests');
 if(!url.pathname.startsWith('/api/'))return originalFetch(input,init);
 const path=url.pathname, method=init?.method??'GET';
 if(method==='DELETE' && path==='/api/order-line-items/synthetic-line')return Response.json({message:'This line has active production ownership.',code:'LINE_ITEM_ACTIVE_WORKFLOW_REMOVE_BLOCKED',details:{activeJob:{stationKey:'roll',stepKey:'queued',status:'queued'}}},{status:409});
 if(method==='POST' && path.endsWith('/corrective-remove')){mutations++;return Response.json({message:'This line belongs to an active Combined Run. Resolve that run before removing it.',code:'CORRECTIVE_REMOVAL_COMBINED_RUN_BLOCKED'},{status:409});}
 if(method!=='GET')throw new Error('Unsupported synthetic mutation');
 if(path==='/api/auth/session')return Response.json({authenticated:true,user:{id:'synthetic-user',role:'admin',isAdmin:true}});
 if(path==='/api/me/orgs')return Response.json({success:true,data:{orgs:[{id:'synthetic-org',name:'Synthetic QA',slug:'synthetic',role:'admin'}],lastActiveOrgId:'synthetic-org'}});
 if(path==='/api/order-status-pills')return Response.json({success:true,data:[pill]});
 if(path==='/api/organization/preferences')return Response.json({});
 if(path==='/api/products')return Response.json([{id:'synthetic-product',name:'Synthetic Window Perf',isActive:true,requiresProductionJob:true,options:[]}]);
 if(path==='/api/order-line-items/synthetic-line/attachments')return Response.json({success:true,data:[]});
 return Response.json({success:true,data:[]});
};
function Fixture(){
 const {setTheme}=useTheme(),{toasts}=useToast();const [theme,setCurrentTheme]=useState('light');
 return <main className="min-h-screen space-y-4 bg-background p-4 text-foreground">
  <h1>Production cancellation — synthetic browser fixture</h1>
  <p>Mocked HTTP only. No real Orders, production jobs, files, invoices or payments.</p>
  <nav className="flex gap-3"><button onClick={()=>{setTheme('light');setCurrentTheme('light');}}>Light</button><button onClick={()=>{setTheme('dark');setCurrentTheme('dark');}}>Dark</button><span>Theme: {theme}</span></nav>
  <section><h2>Canonical state: Open · In production · 8 units remaining</h2><OrderStatusPillSelector orderId="synthetic-order" currentState="open" currentPillId={pill.id} currentPillValue="Complete" /></section>
  <OrderLineItemsSection orderId="synthetic-order" orderNumber="QA-only" readOnly={false} lineItems={[line]} />
  <output>Corrective-removal requests: {mutations}</output>
  <section aria-label="Notifications">{toasts.map(item=><p key={item.id} role="status">{item.title} · {item.description}</p>)}</section>
 </main>;
}
createRoot(document.getElementById('root')!).render(<ThemeProvider><QueryClientProvider client={queryClient}><BrowserRouter><NavigationGuardProvider><TooltipProvider><Fixture/></TooltipProvider></NavigationGuardProvider></BrowserRouter></QueryClientProvider></ThemeProvider>);
