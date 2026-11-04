import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import { filterProductionJobsForTab } from '@/lib/productionBoard';
import { productionRunToBoardItem } from '@/lib/productionRuns';
import type { ProductionRunListItem } from '@/hooks/useProduction';
import ProductionBoard from './production';

jest.mock('@/components/titan', () => ({ Page: ({ children }: any) => <main>{children}</main>, PageHeader: ({title}: any) => <h1>{title}</h1>, ContentLayout: ({children}: any) => <div>{children}</div> }));
jest.mock('@/components/production/ProductionItemFocus', () => ({ProductionItemFocus: () => null}));
jest.mock('@/features/production/views/ProductionOverviewPage', () => ({__esModule: true, default: () => null}));
let jobs: Array<any> = [], runs: Array<any> = [];
const config = {enabledViews: ['roll'], defaultView: 'roll'};
const requests = jest.fn();
const renderer = jest.fn();
jest.mock('@/hooks/useProduction', () => ({
  useProductionConfig: () => ({data: config, isLoading: false}),
  useProductionJobs: (filters: any) => {
    requests(filters);
    const query = useQuery({queryKey: ['roll-fixture-jobs'], queryFn: async () => jobs, initialData: jobs, staleTime: Infinity});
    return {...query, stationIssues: []};
  },
  useProductionRuns: () => useQuery({queryKey: ['roll-fixture-runs'], queryFn: async () => runs, initialData: runs, staleTime: Infinity}),
  useRecentlyCompletedProductionJobs: () => ({data: Array.from({length: 12}, (_,i) => ({id:`completed-${i}`})),refetch: async () => ({data:[]})}),
}));
jest.mock('@/features/production/ProductionViewRenderer', () => ({__esModule: true, default: (props: any) => {
  renderer(props);
  return <div data-testid="queue">{props.status === 'done' ? `History search: ${props.queueSearch}` : filterProductionJobsForTab([...props.jobs, ...props.runs.map(productionRunToBoardItem)], props.status).map((row: any) => <p key={row.id}>{row.id}</p>)}</div>;
} }));
let host: HTMLDivElement, root: Root, qc: QueryClient;
const fixtureJob = (i: number, status = 'queued') => ({id:`job-${i}`, status, order:{orderNumber:String(30000+i), customerName:'QA roll buyer'}});
beforeEach(() => {
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true}); localStorage.clear(); requests.mockClear(); renderer.mockClear();
  jobs=Array.from({length:119},(_,i)=>fixtureJob(i, i<60?'queued':i<100?'in_progress':'paused'));
  runs=[{kind:'production_run',id:'run-1',status:'queued',displayNumber:'RUN-11',orderNumber:'20720',lifecycleState:'paused',memberCount:2,totalAllocatedQuantity:10,
    members:[{orderNumber:'20720',description:'Matching member'},{orderNumber:'20721',description:'Other member'}],files:[]}];
  qc=new QueryClient({defaultOptions:{queries:{retry:false}}});host=document.createElement('div');document.body.append(host);root=createRoot(host);
  jest.useFakeTimers();
});
afterEach(()=>{act(()=>root.unmount());qc.clear();host.remove();jest.useRealTimers();});
const render = async () => act(async()=>root.render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={['/production/roll']}><ProductionBoard /></MemoryRouter></QueryClientProvider>));
const queue=()=>host.querySelector('[data-testid=queue]')!;
const clear=()=>Array.from(host.querySelectorAll('button')).find(button=>button.textContent==='Clear Filters')!;
const search=async(value:string)=>{await act(async()=>{Simulate.change(host.querySelector('input[aria-label="Search production queue"]')!,{target:{value}} as any);});await act(async()=>{jest.advanceTimersByTime(250);});};
const tab=async(label:string)=>{const target=Array.from(host.querySelectorAll<HTMLButtonElement>('[role=tab]')).find(item=>item.textContent?.startsWith(label))!;await act(async()=>{Simulate.mouseDown(target,{button:0,ctrlKey:false} as any);target.click();});};
const lastProps=()=>renderer.mock.calls.at(-1)![0] as any;

test('reproduces persisted 20720 hiding all standalone active work; totals stay 120 and Clear Filters restores all work', async()=>{
  localStorage.setItem('productionQueueControls.roll',JSON.stringify({search:'20720'}));
  localStorage.setItem('productionTab.roll','in_progress');
  await render();expect(host.textContent).toContain('120 total active work units');expect(queue().textContent).toBe('');
  expect(host.textContent).toContain('Search hides all work in this status');
  expect(host.querySelector('[role=tab][data-state=active]')?.textContent).toContain('In Progress40');
  await act(async()=>clear().click());expect(queue().querySelectorAll('p')).toHaveLength(120);
  expect((host.querySelector('input') as HTMLInputElement).value).toBe('');expect(lastProps().filterResetVersion).toBe(1);
  expect(JSON.parse(localStorage.getItem('productionQueueControls.roll')!).search).toBe('');
  expect(requests.mock.calls.every(([filters])=>!(filters as any).search)).toBe(true);
});
test('all status tabs count the same work units; a paused Combined Run appears once',async()=>{
  await render(); await tab('All'); expect(queue().querySelectorAll('p')).toHaveLength(120);
  await tab('Queued');expect(queue().querySelectorAll('p')).toHaveLength(60);
  await tab('In Progress');expect(queue().querySelectorAll('p')).toHaveLength(40);
  await tab('Paused');expect(queue().querySelectorAll('p')).toHaveLength(20);expect(queue().textContent).toContain('run-1');
  await tab('Completed');expect(queue().textContent).toContain('History search:');expect(host.textContent).toContain('Completed12');
});
test('matching Order 20720 finds a Combined Run member and standalone work beyond the first 100 records',async()=>{
  jobs.push({...fixtureJob(500), id:'last-job', order:{orderNumber:'20720'}});
  await render();await tab('All');await search('20720');
  expect(queue().textContent).toContain('last-job');expect(queue().textContent).toContain('run-1');expect(queue().querySelectorAll('p')).toHaveLength(2);
  expect(host.textContent).toContain('121 total active work units');
  await search('nothing-matches');expect(queue().textContent).toBe('');expect(host.textContent).toContain('Search hides all work');
});
test('React Query refresh updates counts while preserving the active search and status',async()=>{
  await render();await tab('All');await search('20720');expect(queue().querySelectorAll('p')).toHaveLength(1);
  await act(async()=>{qc.setQueryData(['roll-fixture-jobs'],[...jobs,{...fixtureJob(600),id:'refetched-job',order:{orderNumber:'20720'}}]);jest.advanceTimersByTime(1);});
  expect(queue().querySelectorAll('p')).toHaveLength(2);expect(host.textContent).toContain('121 total active work units');
  expect((host.querySelector('input') as HTMLInputElement).value).toBe('20720');
});


test('Refresh work rereads the queue and refreshes the sidebar without clearing operator filters',async()=>{
  await render();await tab('All');await search('20720');
  const invalidate = jest.spyOn(qc,'invalidateQueries');
  jobs=[...jobs,{...fixtureJob(700),id:'fresh-from-query',order:{orderNumber:'20720'}}];
  await act(async()=>{Array.from(host.querySelectorAll('button')).find(button=>button.textContent==='Refresh work')!.click();});
  await act(async()=>{jest.advanceTimersByTime(5);});
  expect(queue().textContent).toContain('fresh-from-query');expect(queue().querySelectorAll('p')).toHaveLength(2);
  expect(invalidate).toHaveBeenCalledWith({queryKey:['/api/operational-summary']});
  expect((host.querySelector('input') as HTMLInputElement).value).toBe('20720');
});


test('run search finds a nonrepresentative member Order and canonical member identifiers',async()=>{
  runs[0].members[1].productionJobId='member-production-unique';
  await render();await tab('All');
  for (const value of ['20721','SO-20721','member-production-unique','RUN-11']) {
    await search(value);expect(queue().querySelectorAll('p')).toHaveLength(1);expect(queue().textContent).toContain('run-1');
  }
});
