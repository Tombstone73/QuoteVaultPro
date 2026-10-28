import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RedoOrderAction, RedoOrderIdentification } from './RedoOrder';
import { apiFetch } from '@/lib/queryClient';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const navigate=jest.fn();
jest.mock('react-router-dom',()=>({useNavigate:()=>navigate,Link:({to,children,...props}:any)=><a href={to} {...props}>{children}</a>}));
jest.mock('@/lib/queryClient',()=>({apiFetch:jest.fn()}));
const source={id:'original',orderNumber:'12345',updatedAt:'2026-10-28T12:00:00.000Z',lineItems:[{id:'line-a',description:'Signs',quantity:10,updatedAt:'2026-10-28T12:00:00.000Z'},{id:'line-b',description:'Stakes',quantity:20,updatedAt:'2026-10-28T12:00:00.000Z'}]};
let root:Root,host:HTMLDivElement;
beforeEach(()=>{jest.clearAllMocks();Object.defineProperty(crypto,'randomUUID',{configurable:true,value:()=> '10000000-0000-4000-8000-000000000001'});host=document.createElement('div');document.body.appendChild(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());document.body.innerHTML='';});
function render(node:React.ReactNode){act(()=>root.render(<QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>));}
function button(text:string){return Array.from(document.querySelectorAll('button')).find(item=>item.textContent===text)!;}
function click(element:HTMLElement){act(()=>element.click());}
function set(element:HTMLInputElement|HTMLSelectElement,value:string){act(()=>{const prototype=element.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,'value')!.set!.call(element,value);element.dispatchEvent(new Event(element.tagName==='SELECT'?'change':'input',{bubbles:true}));});}
function fill(){
 click(button('Create Redo Order'));
 click(document.querySelector('fieldset input[type=checkbox]')!);
 const qty=document.querySelector('[aria-label="Replacement quantity: Signs"]') as HTMLInputElement;
 expect(qty.value).toBe('');set(qty,'2');
 set(document.querySelector('#redo-reason')!,'Print quality');set(document.querySelector('#redo-date')!,'2026-11-04');
 click(Array.from(document.querySelectorAll('fieldset input[type=checkbox]')).at(-1)! as HTMLElement);
}
test('authorized staff can open creation from closed sources; quantities require explicit input and no charge is the sole disposition',()=>{
 render(<RedoOrderAction order={{...source,state:'closed'} as any} authorized />);fill();
 expect(document.querySelectorAll('fieldset input[type=number]')).toHaveLength(1);
 expect(document.querySelector('#redo-disposition')?.textContent).toBe('NO CUSTOMER CHARGE');expect(button('Confirm Create Redo Order').disabled).toBe(false);
});
test('unauthorized action is absent and unsaved changes can disable the entry point',()=>{
 render(<RedoOrderAction order={source} authorized={false}/>);expect(document.body.textContent).not.toContain('Create Redo Order');
 render(<RedoOrderAction order={source} authorized disabled/>);expect(button('Create Redo Order').disabled).toBe(true);
});
test('entry creates only selected partial work, confirms persisted data, and navigates to canonical new Order',async()=>{
 const saved={id:'redo',redoSourceOrderId:source.id,redoDisposition:'no_customer_charge',total:'0',promisedDate:'2026-11-04T12:00:00.000Z',lineItems:[{redoSourceLineItemId:'line-a',quantity:2}]};
 (apiFetch as jest.Mock).mockResolvedValueOnce({ok:true,status:201,json:async()=>({order:{id:'redo'}})}).mockResolvedValueOnce({ok:true,json:async()=>saved});
 render(<RedoOrderAction order={source} authorized/>);fill();
 await act(async()=>{button('Confirm Create Redo Order').click();});
 expect((apiFetch as jest.Mock).mock.calls[0][0]).toBe('/api/orders/original/redo');
 const payload=JSON.parse((apiFetch as jest.Mock).mock.calls[0][1].body);expect(payload.lines).toEqual([{sourceLineItemId:'line-a',quantity:2,expectedUpdatedAt:source.updatedAt}]);expect(payload.disposition).toBe('no_customer_charge');expect(payload.confirmed).toBe(true);
 expect(navigate).toHaveBeenCalledWith('/orders/redo');
});
test('uncertain response retries the same durable request and does not navigate on unconfirmed readback',async()=>{
 (apiFetch as jest.Mock).mockRejectedValueOnce(new Error('Lost response')).mockResolvedValueOnce({ok:true,status:201,json:async()=>({order:{id:'redo'}})}).mockResolvedValueOnce({ok:true,json:async()=>({id:'redo',total:'999'})});
 render(<RedoOrderAction order={source} authorized/>);fill();await act(async()=>{button('Confirm Create Redo Order').click();});
 await act(async()=>{button('Retry and confirm replacement').click();});
 expect((apiFetch as jest.Mock).mock.calls[0][1].body).toBe((apiFetch as jest.Mock).mock.calls[1][1].body);expect(navigate).not.toHaveBeenCalled();expect(document.querySelector('[role=alert]')?.textContent).toContain('unconfirmed');
});
test('double-click while pending issues only one create request',async()=>{
 let resolve:any;(apiFetch as jest.Mock).mockReturnValue(new Promise(r=>{resolve=r;}));
 render(<RedoOrderAction order={source} authorized/>);fill();const submit=button('Confirm Create Redo Order');act(()=>{submit.click();submit.click();});expect(apiFetch).toHaveBeenCalledTimes(1);
 await act(async()=>{resolve({ok:false,status:400,json:async()=>({message:'Invalid selection'})});});
});
test('invalid parent/child quantities are rejected before the API',async()=>{
 render(<RedoOrderAction order={{...source,lineItems:[{...source.lineItems[0]},{...source.lineItems[1],parentLineItemId:'line-a'}]}} authorized/>);fill();
 set(document.querySelector('[aria-label="Replacement quantity: Stakes"]')!,'3');await act(async()=>{button('Confirm Create Redo Order').click();});expect(apiFetch).not.toHaveBeenCalled();expect(document.querySelector('[role=alert]')?.textContent).toContain('proportions');
});
test('persistent banner links root and immediate source and lists every related Redo',()=>{
 render(<RedoOrderIdentification order={{...source,redoRootOrderId:'original',redoReason:'Print quality',redoExplanation:'Color mismatch',status:'in_production',state:'open',promisedDate:'2026-11-04T12:00:00Z',redoOriginal:{id:'original',orderNumber:'12345'},redoSource:{id:'previous-redo',orderNumber:'12346'},relatedRedos:[{id:'redo-a',orderNumber:'12346',redoReason:'Print quality',promisedDate:'2026-11-04',status:'new',state:'open'},{id:'redo-b',orderNumber:'12347',redoReason:'Missing pieces',promisedDate:'2026-11-05',status:'new',state:'open'}]} as any}/>);
 expect(document.body.textContent).toContain('REDO / REPLACEMENT ORDER');expect(document.body.textContent).toContain('NO CUSTOMER CHARGE');
 expect(document.querySelector('a[href="/orders/original"]')?.textContent).toBe('#12345');expect(document.querySelector('a[href="/orders/previous-redo"]')).not.toBeNull();expect(document.querySelectorAll('section[aria-label="Related replacement orders"] li')).toHaveLength(2);
});

test('a persisted routing blocker remains prominent after a fresh render',()=>{
 render(<RedoOrderIdentification order={{...source,redoRootOrderId:'original',redoOriginal:{id:'original',orderNumber:'12345'},status:'new',state:'open',lineItems:[{id:'pending-line',description:'Signs',workflowState:'new',productionNotes:'Configure production station roll. Then use Save & Route Jobs.'}]} as any}/>);
 expect(document.body.textContent).toContain('Action needed for Signs');expect(document.body.textContent).toContain('Configure production station roll');expect(document.body.textContent).toContain('Save & Route Jobs');
});
