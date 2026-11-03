import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import { SaveCustomerShippingAddress } from './SaveCustomerShippingAddress';
import { customerShippingAddressFromParty } from '@shared/fulfillmentCustomerAddress';

const api = jest.fn<(...args:any[])=>Promise<any>>();
jest.mock('@/hooks/useFulfillment',()=>({apiCall:(...args:any[])=>api(...args),toFulfillmentError:(error:Error)=>({message:error.message})}));
const destination={name:'Receiving',company:'Test buyer',address1:'123 Saved St',address2:null,city:'Carmel',state:'IN',postalCode:'46032',country:'US',phone:null,email:null};
const target={customerId:'customer',companyName:'Test buyer',updatedAt:'2026-11-03T12:00:00.000Z',address:{...customerShippingAddressFromParty(destination),shippingState:''}};
let host:HTMLDivElement,root:Root;
const prepare=jest.fn<()=>Promise<{updatedAt:string;destination:typeof destination}>>();
beforeEach(()=>{
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});host=document.createElement('div');document.body.append(host);root=createRoot(host);
  api.mockReset();prepare.mockReset();prepare.mockResolvedValue({updatedAt:'2026-11-03T13:00:00.000Z',destination});
  api.mockImplementation(async(_path,init)=>init?.method==='POST'?{...target,address:customerShippingAddressFromParty(destination)}:target);
});
afterEach(()=>{act(()=>root.unmount());host.remove();});
const render=async(blind=false)=>act(async()=>root.render(<SaveCustomerShippingAddress shipmentId="shipment" blindShipping={blind} destination={destination} prepareShipment={prepare}/>));
const button=(label:string)=>Array.from(host.querySelectorAll('button')).find(button=>button.textContent===label)!;
const check=()=>act(()=>Simulate.change(host.querySelector('input')!,{target:{checked:true}} as any));

test('defaults unchecked and saves a one-time/drop shipment without a profile write',async()=>{
  await render();expect((host.querySelector('input') as HTMLInputElement).checked).toBe(false);
  await act(async()=>button('Save shipping address').click());
  expect(prepare).toHaveBeenCalledTimes(1);expect(api.mock.calls.filter(call=>call[1]?.method==='POST')).toHaveLength(0);
  expect(host.querySelector('[role=status]')?.textContent).toContain('Customer profile unchanged');
});
test('explicit selection sends both reviewed revisions and confirms missing state correction',async()=>{
  await render();check();await render();expect((host.querySelector('input') as HTMLInputElement).checked).toBe(true);
  await act(async()=>button('Save shipping address').click());
  const request=api.mock.calls.find(call=>call[1]?.method==='POST')!;
  expect(JSON.parse(request[1].body)).toEqual({customerId:'customer',expectedCustomerUpdatedAt:target.updatedAt,expectedShipmentUpdatedAt:'2026-11-03T13:00:00.000Z'});
  expect(host.querySelector('[role=status]')?.textContent).toContain("Test buyer's default shipping address");
  expect((host.querySelector('input') as HTMLInputElement).checked).toBe(false);
});
test('blind destinations never update a profile even if the option was previously selected',async()=>{
  await render();check();await render(true);
  expect((host.querySelector('input') as HTMLInputElement).disabled).toBe(true);
  await act(async()=>button('Save shipping address').click());
  expect(api.mock.calls.filter(call=>call[1]?.method==='POST')).toHaveLength(0);
  expect(host.textContent).toContain('Blind-shipping destinations stay shipment-only');
});
test('profile failure is separate from confirmed shipment saving; no automatic stale retry',async()=>{
  api.mockImplementation(async(_path,init)=>{if(init?.method==='POST')throw new Error('Customer changed. Review latest address.');return target;});
  await render();check();await act(async()=>button('Save shipping address').click());
  expect(host.querySelector('[role=alert]')?.textContent).toContain('Shipment address saved. Customer profile update was not confirmed: Customer changed');
  expect(api.mock.calls.filter(call=>call[1]?.method==='POST')).toHaveLength(1);
  await act(async()=>button('Review latest customer address').click());
  expect((host.querySelector('input') as HTMLInputElement).checked).toBe(false);
});
test('failed shipment save retains selection and prevents any customer mutation',async()=>{
  prepare.mockRejectedValue(new Error('Shipment stale; edits retained'));
  await render();check();await act(async()=>button('Save shipping address').click());
  expect(host.querySelector('[role=alert]')?.textContent).toContain('Customer profile unchanged');
  expect((host.querySelector('input') as HTMLInputElement).checked).toBe(true);
  expect(api.mock.calls.filter(call=>call[1]?.method==='POST')).toHaveLength(0);
});
test('customer authorization failure leaves shipment-only saving available',async()=>{
  api.mockRejectedValue(new Error('Customer-edit access is required'));
  await render();expect((host.querySelector('input') as HTMLInputElement).disabled).toBe(true);
  expect(host.textContent).toContain('Customer-edit access is required');
  await act(async()=>button('Save shipping address').click());expect(prepare).toHaveBeenCalledTimes(1);
});
test('legacy-only saved customer addresses remain visible for deliberate review',async()=>{
  api.mockResolvedValue({...target,address:Object.fromEntries(Object.keys(target.address).map(key=>[key,''])),legacyAddress:'99 Legacy Street, Indianapolis IN 46201'});
  await render();expect(host.textContent).toContain('Current customer default: 99 Legacy Street, Indianapolis IN 46201');
  expect((host.querySelector('input') as HTMLInputElement).checked).toBe(false);
});
test('a late profile response does not claim newer local destination edits were saved to the profile',async()=>{
  let release!:(value:unknown)=>void;
  api.mockImplementation(async(_path,init)=>init?.method==='POST'?new Promise(resolve=>{release=resolve;}):target);
  await render();check();await act(async()=>button('Save shipping address').click());
  await act(async()=>root.render(<SaveCustomerShippingAddress shipmentId="shipment" blindShipping={false} destination={{...destination,address1:'Newer local destination'}} prepareShipment={prepare}/>));
  await act(async()=>release({...target,address:customerShippingAddressFromParty(destination)}));
  expect(host.querySelector('[role=status]')?.textContent).toContain('Newer destination edits have not updated the profile');
  expect((host.querySelector('input') as HTMLInputElement).checked).toBe(false);
});
