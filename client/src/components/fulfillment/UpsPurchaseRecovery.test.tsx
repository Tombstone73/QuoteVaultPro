import React, {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {Simulate} from 'react-dom/test-utils';
import {jest,beforeEach,afterEach,test,expect} from '@jest/globals';
import {apiCall} from '@/hooks/useFulfillment';
import {UpsPurchaseRecovery} from './UpsPurchaseRecovery';
jest.mock('@/hooks/useFulfillment',()=>({apiCall:jest.fn(),toFulfillmentError:(error:any)=>({message:error.message})}));
jest.mock('@/components/ui/dialog',()=>({Dialog:({open,children}:any)=>open?<>{children}</>:null,DialogContent:({children}:any)=><div>{children}</div>,DialogHeader:({children}:any)=><div>{children}</div>,DialogTitle:({children}:any)=><h2>{children}</h2>,DialogDescription:({children}:any)=><p>{children}</p>,DialogFooter:({children}:any)=><footer>{children}</footer>}));
let root:Root,element:HTMLDivElement;const changed=jest.fn<()=>Promise<void>>().mockResolvedValue(undefined);
const button=(text:string)=>Array.from(element.querySelectorAll('button')).find(b=>b.textContent===text)!;
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;element=document.createElement('div');root=createRoot(element);jest.mocked(apiCall).mockImplementation(async(path)=>String(path).endsWith('/recover')?{}:[{id:'attempt',status:'PURCHASED',labels:[{id:'label'}]}] as any);});
afterEach(()=>{act(()=>root.unmount());jest.clearAllMocks();});
const render=(canRecover=true,savedResponseAvailable=true)=>act(()=>root.render(<UpsPurchaseRecovery shipmentId="shipment" purchaseId="attempt" canRecover={canRecover} savedResponseAvailable={savedResponseAvailable} onChanged={changed}/>));
test('recovery requires permission, saved evidence and explicit confirmation; it never purchases or prints',async()=>{
 render(false);expect(element.textContent).toContain('administrator');expect(element.querySelector('button')).toBeNull();render(true,false);expect(element.textContent).toContain('UPS account');expect(element.querySelector('button')).toBeNull();render();await act(async()=>button('Review saved UPS response').click());expect(button('Recover saved response').disabled).toBe(true);expect(apiCall).not.toHaveBeenCalled();
 act(()=>Simulate.change(element.querySelector('input')!,{target:{checked:true}} as any));await act(async()=>button('Recover saved response').click());expect(jest.mocked(apiCall).mock.calls.map(call=>call[0])).toEqual(['/api/fulfillment/shipments/shipment/ups-labels/attempt/recover','/api/fulfillment/shipments/shipment/ups-labels']);expect(changed).toHaveBeenCalledTimes(1);
});
test('failed or stale recovery remains visible and refreshes history without another purchase',async()=>{
 render();await act(async()=>button('Review saved UPS response').click());act(()=>Simulate.change(element.querySelector('input')!,{target:{checked:true}} as any));jest.mocked(apiCall).mockRejectedValue(new Error('Shipment changed; review UPS history'));await act(async()=>button('Recover saved response').click());expect(element.textContent).toContain('Shipment changed');expect(changed).toHaveBeenCalledTimes(1);expect(apiCall).toHaveBeenCalledTimes(1);expect(element.textContent).toContain('Do not buy another label');
});
test('missing persisted labels cannot be presented as confirmed recovery',async()=>{
 render();await act(async()=>button('Review saved UPS response').click());act(()=>Simulate.change(element.querySelector('input')!,{target:{checked:true}} as any));jest.mocked(apiCall).mockImplementation(async(path)=>String(path).endsWith('/recover')?{}:[{id:'attempt',status:'PURCHASED',labels:[]}] as any);await act(async()=>button('Recover saved response').click());expect(element.textContent).toContain('Recovery readback is not confirmed');
});
