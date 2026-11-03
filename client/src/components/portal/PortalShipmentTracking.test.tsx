import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import { PortalShipmentTracking } from './PortalShipmentTracking';
import type { PortalOrderFulfillmentSummaryDto } from '@/hooks/usePortal';
import type { ShipmentTrackingPackage } from '@shared/shipmentTracking';

const pkg = (patch: Partial<ShipmentTrackingPackage> = {}): ShipmentTrackingPackage => ({ shipmentId:'ship-1',packageId:'pkg-1',carrier:'UPS',serviceLevel:'Ground',trackingNumber:'1Z1234567890123456',
  trackingUrl:'javascript:alert(1)',status:'in_transit',lastCarrierUpdateAt:'2026-11-01T12:00:00Z',lastCheckedAt:'2026-11-02T12:00:00Z',estimatedDeliveryDate:'2026-11-05',deliveredAt:null,updatesUnavailable:false,...patch });
const summary = (packages: ShipmentTrackingPackage[] = [pkg()]): PortalOrderFulfillmentSummaryDto => ({ methodLabel:'Shipping',statusLabel:'Shipped',trackingNumber:packages[0]?.trackingNumber??null,trackingUrl:null,shippedAt:'2026-11-01',pickupReadyAt:null,trackingPackages:packages });
let root: Root, element: HTMLDivElement;
beforeEach(()=>{element=document.createElement('div');document.body.append(element);root=createRoot(element);Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});});
afterEach(()=>{act(()=>root.unmount());element.remove();jest.restoreAllMocks();});
test('renders trusted UPS links and copies the exact tracking number with accessible feedback', async()=>{
  const write=jest.fn<()=>Promise<void>>().mockResolvedValue(undefined); Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:write}});
  act(()=>root.render(<PortalShipmentTracking summary={summary()} />));
  expect(element.querySelector('a')?.href).toBe('https://www.ups.com/track?tracknum=1Z1234567890123456');
  expect(element.textContent).toContain('Carrier: In Transit'); expect(element.textContent).toContain('Estimated delivery:');
  await act(async()=>Simulate.click(element.querySelector('button')!)); expect(write).toHaveBeenCalledWith('1Z1234567890123456'); expect(element.querySelector('[role=status]')?.textContent).toContain('Copied');
});
test('multiple packages have separate status, copy controls and visible non-color exception/delivery labels', ()=>{
  act(()=>root.render(<PortalShipmentTracking summary={summary([pkg({status:'exception'}),pkg({packageId:'pkg-2',trackingNumber:'1234567890',carrier:'FedEx',status:'delivered',deliveredAt:'2026-11-02T10:00:00Z'})])} />));
  expect(element.querySelectorAll('button')).toHaveLength(2); expect(element.textContent).toContain('Package 2'); expect(element.textContent).toContain('Delivery Exception'); expect(element.textContent).toContain('Carrier confirmed delivery:');
});
test('unknown carriers and invalid numbers stay copyable without unsafe links or implied delivery',()=>{
  act(()=>root.render(<PortalShipmentTracking summary={summary([pkg({carrier:'Other',trackingNumber:'javascript:alert(1)',status:'unavailable',updatesUnavailable:true})])} />));
  expect(element.querySelector('a')).toBeNull(); expect(element.querySelector('button')).not.toBeNull(); expect(element.textContent).toContain('Tracking Unavailable'); expect(element.textContent).not.toContain('Delivered');
});
test('missing tracking and legacy responses remain readable without inferring status from Shipped',()=>{
  act(()=>root.render(<PortalShipmentTracking summary={summary([])} />)); expect(element.textContent).toContain('No active tracking number');
  act(()=>root.render(<PortalShipmentTracking summary={{...summary(),trackingPackages:undefined}} compact />)); expect(element.textContent).toContain('1Z1234567890123456'); expect(element.textContent).toContain('Tracking Unavailable');
});
test('carrier outage retains confirmed status and provides honest next steps and copy failure feedback',async()=>{
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw new Error('blocked');}}});
  act(()=>root.render(<PortalShipmentTracking summary={summary([pkg({updatesUnavailable:true})])} />));
  expect(element.textContent).toContain('Showing the last confirmed carrier status');
  await act(async()=>Simulate.click(element.querySelector('button')!)); expect(element.querySelector('[role=status]')?.textContent).toContain('copy it manually');
});
