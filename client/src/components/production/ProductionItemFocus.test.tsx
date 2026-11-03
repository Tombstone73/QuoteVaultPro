import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ProductionItemFocus } from './ProductionItemFocus';
import { apiFetch } from '@/lib/queryClient';
import { useProductionJob, useProductionRuns } from '@/hooks/useProduction';
import { productionItemLink, prepressItemLink, productionItemBoardLink } from '@shared/productionItemLocation';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const navigate = jest.fn();
const renderBoard = jest.fn();
let mockDelayRow = false;
jest.mock('react-router-dom', () => ({ useNavigate: () => navigate, useLocation: () => ({ pathname: '/production', search: '?jobId=old-job' }), Link: ({ to, children }: any) => <a href={to}>{children}</a> }));
jest.mock('@/lib/queryClient', () => ({ apiFetch: jest.fn() }));
jest.mock('@/hooks/useProduction', () => ({ useProductionJob: jest.fn(), useProductionRuns: jest.fn() }));
jest.mock('@/features/production/ProductionViewRenderer', () => ({ __esModule: true, default: (props: any) => { renderBoard(props); return <div data-production-job-id={mockDelayRow ? undefined : 'current-job'}>Existing station controls</div>; } }));
let root: Root, host: HTMLDivElement;
const location = { jobId: 'current-job', lineItemId: 'line', orderId: 'order', stationKey: 'roll', stepKey: 'print', status: 'queued', prepress: false, runId: null };
beforeEach(() => {
  jest.clearAllMocks(); mockDelayRow = false; host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  (useProductionJob as jest.Mock).mockReturnValue({ data: { id: 'current-job' } });
  (useProductionRuns as jest.Mock).mockReturnValue({ data: [] });
});
afterEach(() => { act(() => root.unmount()); host.remove(); });
async function mount(data: any = location) {
  (apiFetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => ({ data }) });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => { root.render(<QueryClientProvider client={client}><ProductionItemFocus jobId="old-job" /></QueryClientProvider>); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
}
test('resolves a canonical ID to the current station and opens an unfiltered existing board', async () => {
  await mount();
  expect(apiFetch).toHaveBeenCalledWith('/api/production/jobs/old-job/location', expect.objectContaining({ cache: 'no-store' }));
  expect(navigate).toHaveBeenCalledWith('/production/roll?jobId=current-job', { replace: true });
  expect(renderBoard).toHaveBeenCalledWith(expect.objectContaining({ viewKey: 'roll', status: 'all', jobs: [expect.objectContaining({ id: 'current-job' })] }));
  expect(host.querySelector('[data-production-job-id]')?.className).toContain('ring-2');
});
test('opens the owning Combined Run without an actionable standalone duplicate', async () => {
  (useProductionJob as jest.Mock).mockReturnValue({ data: undefined });
  (useProductionRuns as jest.Mock).mockReturnValue({ data: [{ id: 'run', members: [{ productionJobId: 'current-job' }] }] });
  await mount({ ...location, runId: 'run' });
  expect(useProductionJob).toHaveBeenCalledWith(undefined);
  expect(renderBoard).toHaveBeenCalledWith(expect.objectContaining({ jobs: [], runs: [expect.objectContaining({ id: 'run' })] }));
});
test('returned work opens the exact Prepress line', async () => {
  await mount({ ...location, prepress: true, stationKey: 'prepress' });
  expect(navigate).toHaveBeenCalledWith('/production/prepress?lineItemId=line', { replace: true });
  expect(renderBoard).not.toHaveBeenCalled();
});
test('highlights a run member when the existing detail panel mounts later', async () => {
  mockDelayRow = true;
  await mount();
  const row = document.createElement('div'); row.dataset.productionJobId = 'current-job';
  await act(async () => { host.querySelector('[data-testid="focused-production-item"]')!.appendChild(row); await Promise.resolve(); });
  expect(row.className).toContain('ring-2');
});
test('missing details explain that the item moved rather than waiting forever', async () => {
  (useProductionJob as jest.Mock).mockReturnValue({ data: undefined, isLoading: false });
  await mount(); expect(host.textContent).toContain('moved or is no longer available');
});
test('links encode canonical IDs and never search by order number', () => {
  expect(productionItemLink('job/a b')).toBe('/production?jobId=job%2Fa%20b');
  expect(prepressItemLink('line/a')).toBe('/production/prepress?lineItemId=line%2Fa');
  expect(productionItemBoardLink({ ...location, stationKey: 'wide_roll' })).toBe('/production/roll?jobId=current-job');
});
