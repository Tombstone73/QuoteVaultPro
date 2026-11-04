import { jest, test, expect, beforeEach, afterEach } from '@jest/globals';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/queryClient';
import { DirectPrintJobDiagnostics } from './DirectPrintJobDiagnostics';
jest.mock('@tanstack/react-query',()=>({useQuery:jest.fn()}));
jest.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:'staff',lastActiveOrgId:'tenant'}})}));
jest.mock('@/lib/queryClient',()=>({apiFetch:jest.fn()}));
const base={id:'job',documentType:'ups_label',copies:1,orderNumber:'20871',agentId:'agent',agentName:'Office',machineLabel:'QA workstation',queueName:'Zebra',destinationName:'Labels',createdAt:'2026-11-04T15:00:00Z',updatedAt:'2026-11-04T15:01:00Z',claimedAt:null,submittedAt:null,failedAt:null,lastError:null};
let root:Root,container:HTMLDivElement;
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;container=document.createElement('div');root=createRoot(container);});
afterEach(()=>{act(()=>root.unmount());jest.clearAllMocks();});
test('persisted failure replaces queued presentation and retains job identity without replay controls',()=>{
  jest.mocked(useQuery).mockReturnValue({data:[{...base,status:'queued'}]} as any);
  act(()=>root.render(<DirectPrintJobDiagnostics jobIds={['job']}/>));expect(container.textContent).toContain('Queued');
  jest.mocked(useQuery).mockReturnValue({data:[{...base,status:'failed',claimedAt:base.updatedAt,failedAt:base.updatedAt,lastError:'Label stock unsupported'}]} as any);
  act(()=>root.render(<DirectPrintJobDiagnostics jobIds={['job']}/>));expect(container.textContent).toContain('Failed');expect(container.textContent).toContain('Label stock unsupported');expect(container.textContent).toContain('not retried automatically');expect(container.textContent).toContain('QA workstation');expect(container.querySelector('button')).toBeNull();
});
test('Windows submission is never described as physical printing and query is tenant/user scoped',async()=>{
  jest.mocked(useQuery).mockReturnValue({data:[{...base,status:'submitted',submittedAt:base.updatedAt}]} as any);
  act(()=>root.render(<DirectPrintJobDiagnostics jobIds={['job']}/>));expect(container.textContent).toContain('physical printing is not confirmed');
  const options=jest.mocked(useQuery).mock.calls[0][0] as any;expect(options.queryKey).toEqual(['direct-print-job-status','tenant','staff',['job']]);expect(options.refetchInterval).toBe(5000);
  jest.mocked(apiFetch).mockResolvedValue({ok:true,json:async()=>({data:[{...base,status:'submitted'}]})} as any);
  await expect(options.queryFn({signal:undefined})).resolves.toHaveLength(1);expect(apiFetch).toHaveBeenCalledWith('/api/direct-print/jobs/status?ids=job',{signal:undefined});
  jest.mocked(apiFetch).mockResolvedValue({ok:false,json:async()=>({error:'denied'})} as any);await expect(options.queryFn({signal:undefined})).rejects.toThrow('Do not assume printing completed');
});
