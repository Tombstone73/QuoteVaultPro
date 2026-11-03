import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ShipmentTracking } from '@/components/orders/ShipmentTracking';
import MyOrders from '@/pages/portal/my-orders';
import OrderDetail from '@/pages/portal/order-detail';
import type { PortalOrderDetailDto } from '@/hooks/usePortal';
import '../../client/src/index.css';

const packages: NonNullable<PortalOrderDetailDto['fulfillmentSummary']['trackingPackages']> = [
  {shipmentId:'synthetic-shipment',packageId:'pkg-1',carrier:'UPS',serviceLevel:'Ground',trackingNumber:'1Z1234567890123456',trackingUrl:'javascript:invalid',status:'in_transit',lastCarrierUpdateAt:'2026-11-01T12:00:00Z',lastCheckedAt:'2026-11-02T12:00:00Z',estimatedDeliveryDate:'2026-11-05',deliveredAt:null,updatesUnavailable:false},
  {shipmentId:'synthetic-shipment-2',packageId:'pkg-2',carrier:'FedEx',serviceLevel:null,trackingNumber:'123456789012',trackingUrl:null,status:'exception',lastCarrierUpdateAt:'2026-11-01T13:00:00Z',lastCheckedAt:'2026-11-02T12:00:00Z',estimatedDeliveryDate:null,deliveredAt:null,updatesUnavailable:true},
];
const order: PortalOrderDetailDto={id:'synthetic-order',orderNumber:'QA-TRACK',displayNumber:'QA-TRACK',numberCore:null,jobLabel:'Synthetic shipment tracking — no live customer',customerPoNumber:'QA',createdAt:'2026-11-01T12:00:00Z',updatedAt:null,displayStatus:'In Progress',rawStatus:null,total:165,itemCount:1,
  proofStatusSummary:{proofRequired:false,statusLabel:'No proof required',actionRequired:false,latestVersionNumber:null,proofLinkAvailable:false,requiredCount:0,approvedCount:0,pendingCount:0,revisionRequestedCount:0},
  fulfillmentSummary:{methodLabel:'Shipping',statusLabel:'Partially shipped',trackingNumber:packages[0].trackingNumber,trackingUrl:null,shippedAt:'2026-11-01T12:00:00Z',pickupReadyAt:null,trackingPackages:packages},lineItems:[],invoiceSummary:null};
window.fetch=async(input,init)=>{
  const path=String(input); if(init?.method && init.method!=='GET') throw new Error('Read-only synthetic fixture');
  const data=path==='/api/portal/orders'?[order]:path==='/api/portal/orders/synthetic-order'?order:
    path==='/api/portal/proofs'||path==='/api/portal/orders/synthetic-order/files'?[]:null;
  return new Response(JSON.stringify({success:data!==null,data}),{status:data===null?404:200,headers:{'Content-Type':'application/json'}});
};
document.documentElement.classList.toggle('dark',new URLSearchParams(location.search).get('theme')==='dark');
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}>
  <BrowserRouter><main className="min-h-screen bg-background p-4 text-foreground"><Routes>
    <Route path="/portal/orders" element={new URLSearchParams(location.search).has("internal") ? <section aria-label="Internal Order summary"><h1>Internal Order tracking</h1><ShipmentTracking summary={{...order.fulfillmentSummary,hasShipments:true}} compact showFulfillmentStatus /></section> : <MyOrders/>}/><Route path="/portal/orders/:id" element={<OrderDetail/>}/>
  </Routes></main></BrowserRouter>
</QueryClientProvider>);
