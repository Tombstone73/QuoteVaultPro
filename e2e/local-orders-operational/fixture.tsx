import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/lib/queryClient';
import { ThemeProvider, useTheme } from '@/hooks/useTheme';
import { NavigationGuardProvider } from '@/contexts/NavigationGuardContext';
import { TooltipProvider } from '@/components/ui/tooltip';
import Orders from '@/pages/orders';
import { orderWorkQueueState } from '@shared/openOrderBadgePolicy';
import '@/index.css';

// Browser interaction fixture only. SQL persistence is covered independently
// by productionCancellationIntegrity.postgres.integration.ts.
const pills = ['New', 'In Production', 'Complete'].map((name, index) => ({
  id: `qa-pill-${index}`, organizationId: 'synthetic-org', stateScope: 'open',
  key: ['new', 'in_production', 'complete'][index], name, color: '#2563eb',
  isActive: true, isDefault: index === 0, sortOrder: index,
}));
const records = ['open', 'open', 'open', 'production_complete', 'closed', 'canceled'].map((state, index) => ({
  id: `qa-order-${index}`, orderNumber: `QA-${index + 1}`, state,
  status: index === 1 ? 'in_production' : 'new',
  statusPillId: pills[index === 1 ? 1 : index === 2 ? 2 : 0].id,
  statusPillValue: pills[index === 1 ? 1 : index === 2 ? 2 : 0].name,
  statusPillKey: pills[index === 1 ? 1 : index === 2 ? 2 : 0].key,
  customerId: 'synthetic-customer', customer: { id: 'synthetic-customer', companyName: 'Synthetic QA Company' },
  customerName: 'Synthetic QA Company', jobLabel: 'Mixed-history test only', priority: 'normal',
  createdAt: '2026-11-01T12:00:00Z', updatedAt: '2026-11-01T12:00:00Z',
  dueDate: null, promisedDate: null, total: '80.00', lineItemsCount: 3, thumbsCount: 0,
  thumbnails: { totalCount: 0, previews: [] }, invoiceState: null,
  productionSummary: { requiredCount: 3, handedOffCount: 1, pendingHandoffCount: 2,
    inProductionCount: 1, completeCount: 0, status: 'partial', printerNames: [], stationKeys: ['roll'], stationLabel: 'Roll' },
}));
let confirmedWrites = 0;
const originalFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof Request ? input.url : input.toString(), location.origin);
  if (url.origin !== location.origin) throw new Error('Synthetic fixture blocks external requests');
  if (!url.pathname.startsWith('/api/')) return originalFetch(input, init);
  const method = init?.method ?? 'GET';
  if (method === 'PATCH' && /^\/api\/orders\/qa-order-\d+\/status-pill$/.test(url.pathname)) {
    const record = records.find(row => row.id === url.pathname.split('/')[3])!;
    const selected = pills.find(pill => pill.id === JSON.parse(String(init?.body)).statusPillId)!;
    record.statusPillId = selected.id; record.statusPillValue = selected.name; record.statusPillKey = selected.key;
    confirmedWrites++;
    return Response.json({ success: true, data: record, statusPill: selected });
  }
  if (method !== 'GET') throw new Error('Unsupported fixture mutation');
  if (url.pathname === '/api/auth/session') return Response.json({ authenticated: true, user: { id: 'synthetic-admin', role: 'admin', isAdmin: true } });
  if (url.pathname === '/api/me/orgs') return Response.json({ success: true, data: { orgs: [{ id: 'synthetic-org', name: 'QA', slug: 'qa', role: 'admin' }], lastActiveOrgId: 'synthetic-org' } });
  if (url.pathname === '/api/order-status-pills') return Response.json({ success: true, data: pills });
  if (url.pathname === '/api/organization/preferences') return Response.json({});
  if (url.pathname === '/api/operational-summary') return Response.json({ orders: records.filter(row => orderWorkQueueState(row) === 'open').length });
  if (url.pathname === '/api/orders') {
    const params = url.searchParams;
    const items = records.filter(row => (!params.get('state') || orderWorkQueueState(row) === params.get('state'))
      && (!params.has('statusPillIds') || params.get('statusPillIds')!.split(',').includes(row.statusPillId))
      && (!params.get('search') || row.orderNumber.toLowerCase().includes(params.get('search')!.toLowerCase())));
    return Response.json({ items, totalCount: items.length, page: 1, pageSize: Number(params.get('pageSize') ?? 25), totalPages: 1, hasNext: false, hasPrev: false });
  }
  return Response.json({ success: true, data: [] });
};
function Fixture() {
  const { setTheme } = useTheme();
  return <><header className="flex gap-4 bg-background p-2 text-foreground">
    <span>Synthetic Orders fixture · mocked HTTP · eight unfinished units remain unchanged</span>
    <button onClick={() => setTheme('light')}>Light</button><button onClick={() => setTheme('dark')}>Dark</button>
    <button onClick={() => alert(`Confirmed fixture writes: ${confirmedWrites}; canonical states: ${records.map(row => row.state).join(', ')}`)}>Fixture readback</button>
  </header><Orders /></>;
}
createRoot(document.getElementById('root')!).render(<ThemeProvider><QueryClientProvider client={queryClient}><BrowserRouter><NavigationGuardProvider><TooltipProvider><Fixture /></TooltipProvider></NavigationGuardProvider></BrowserRouter></QueryClientProvider></ThemeProvider>);
