import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { jest, beforeEach, afterEach, expect, test } from '@jest/globals';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { CloseJobOverrideDialog } from './CloseJobOverrideDialog';
import { FulfillmentProductionOverride } from '@/components/fulfillment/FulfillmentProductionOverride';
const mockInvalidation=jest.fn(),mockToast=jest.fn();
jest.mock('@tanstack/react-query',()=>({useQuery:jest.fn(),useQueryClient:()=>({invalidateQueries:mockInvalidation})}));
jest.mock('@/lib/queryClient',()=>({apiRequest:jest.fn()}));
jest.mock('@/hooks/use-toast',()=>({useToast:()=>({toast:mockToast})}));
jest.mock('@/contexts/WorkspaceContext',()=>({WorkspaceLabel:(props:any)=><label {...props}/>,useWorkspaceFieldProps:(props:any)=>props}));
jest.mock('@/components/ui/dialog',()=>({Dialog:({open,children}:any)=>open?<>{children}</>:null,DialogContent:({children}:any)=><div>{children}</div>,DialogHeader:({children}:any)=><div>{children}</div>,DialogTitle:({children}:any)=><h2>{children}</h2>,DialogDescription:({children}:any)=><p>{children}</p>,DialogFooter:({children}:any)=><footer>{children}</footer>}));
jest.mock('@/components/ui/checkbox',()=>({Checkbox:({checked,onCheckedChange,...props}:any)=><input type="checkbox" checked={checked} onChange={e=>onCheckedChange(e.target.checked)} {...props}/>}));
jest.mock('@/components/ui/select',()=>({Select:({children}:any)=><div>{children}</div>,SelectTrigger:({children}:any)=><div>{children}</div>,SelectContent:({children}:any)=><div>{children}</div>,SelectItem:({children}:any)=><span>{children}</span>,SelectValue:()=>null}));
let root:Root,element:HTMLDivElement,preview:any;
const target={orderId:'order',orderNumber:'QA-20871'};
const buttons=(text:string)=>Array.from(element.querySelectorAll('button')).find(b=>b.textContent===text)!;
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;element=document.createElement('div');root=createRoot(element);preview={canCloseJobOverride:true,productionComplete:false,remainingProductionQuantity:10,remainingFulfillmentQuantity:8,requiresProductionBootstrap:false,productionStarted:true,activeProductionJobCount:1};jest.mocked(useQuery).mockImplementation(()=>({data:preview,isLoading:false,isError:false,refetch:async()=>({isError:false})}) as any);jest.mocked(apiRequest).mockResolvedValue({json:async()=>({success:true,data:{id:'order'}})} as Response);});
afterEach(()=>{act(()=>root.unmount());jest.clearAllMocks();});
test('Fulfillment exposes the same preview only for authorized staff and never mutates on opening',async()=>{
 act(()=>root.render(<FulfillmentProductionOverride {...target} canOverride={false}/>));expect(element.textContent).toBe('');
 act(()=>root.render(<FulfillmentProductionOverride {...target} canOverride/>));await act(async()=>buttons('Production Completion Override').click());expect(element.textContent).toContain('Remaining production: 10');expect(apiRequest).not.toHaveBeenCalled();
});
test('production-only confirmation uses canonical completion and never reconciles fulfillment',async()=>{
 act(()=>root.render(<CloseJobOverrideDialog target={target} productionOnly onOpenChange={()=>{}}/>));const action=buttons('Production Completion Override');expect(action.disabled).toBe(true);
 act(()=>Simulate.change(element.querySelector('#production-only-confirmation')!,{target:{checked:true}} as any));expect(action.disabled).toBe(false);
 await act(async()=>action.click());expect(apiRequest).toHaveBeenCalledTimes(1);expect(apiRequest).toHaveBeenCalledWith('POST','/api/orders/order/complete-production',expect.objectContaining({confirmBypass:true,closeJobOverride:true}),expect.objectContaining({signal:expect.any(AbortSignal)}));expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({title:'Production completed'}));expect(mockInvalidation).toHaveBeenCalledWith({queryKey:['fulfillment']});
});
test('changed preview clears approval; bootstrap acknowledgement and failures remain blocking',async()=>{
 const render=()=>act(()=>root.render(<CloseJobOverrideDialog target={target} productionOnly onOpenChange={()=>{}}/>));render();act(()=>Simulate.change(element.querySelector('#production-only-confirmation')!,{target:{checked:true}} as any));
 preview={...preview,requiresProductionBootstrap:true,remainingProductionQuantity:20};render();expect(buttons('Production Completion Override').disabled).toBe(true);
 act(()=>{for(const input of element.querySelectorAll('input[type="checkbox"]'))Simulate.change(input,{target:{checked:true}} as any);});
 jest.mocked(apiRequest).mockRejectedValue(new Error('Production source changed; refresh preview'));await act(async()=>buttons('Production Completion Override').click());expect(apiRequest).toHaveBeenCalledTimes(1);expect(element.querySelector('h2')?.textContent).toBe('Production Completion Override');expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({variant:'destructive'}));
});
test('ordinary Close Job Override preserves its existing two canonical operations',async()=>{
 act(()=>root.render(<CloseJobOverrideDialog target={target} onOpenChange={()=>{}}/>));await act(async()=>buttons('Close Job Override').click());expect(jest.mocked(apiRequest).mock.calls.map(call=>call[1])).toEqual(['/api/orders/order/complete-production','/api/orders/order/reconcile-historical-fulfillment']);
});

test('committed completion does not wait for a stalled projection refetch',async()=>{
 mockInvalidation.mockImplementation(()=>new Promise(()=>{}));const onClose=jest.fn();
 act(()=>root.render(<CloseJobOverrideDialog target={target} onOpenChange={onClose}/>));
 await act(async()=>buttons('Close Job Override').click());
 expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({title:'Job operationally completed'}));expect(onClose).toHaveBeenCalledWith(false);
 mockInvalidation.mockReset();
});

test('fulfillment failure identifies committed production and requires fresh preview before retry',async()=>{
 jest.mocked(apiRequest).mockRejectedValueOnce(new Error('busy'));
 act(()=>root.render(<CloseJobOverrideDialog target={target} onOpenChange={()=>{}}/>));
 await act(async()=>buttons('Close Job Override').click());
 expect(buttons('Close Job Override').disabled).toBe(true);expect(element.textContent).toContain('Refresh live preview');
 await act(async()=>buttons('Refresh live preview').click()); expect(buttons('Close Job Override').disabled).toBe(false);
 jest.mocked(apiRequest).mockResolvedValueOnce({json:async()=>({success:true})} as Response).mockRejectedValueOnce(new Error('Fulfillment busy'));
 await act(async()=>buttons('Close Job Override').click());
 expect(mockToast).toHaveBeenLastCalledWith(expect.objectContaining({description:expect.stringContaining('Production is complete; fulfillment was not confirmed.')}));
});
