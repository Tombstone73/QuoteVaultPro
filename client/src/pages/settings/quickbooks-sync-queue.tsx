import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowLeft, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, ListPlus, RefreshCw, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useActiveOrganizationRole } from '@/hooks/useActiveOrganizationRole';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import {
  getQuickBooksSyncPageRange,
  getQuickBooksSyncPageSizeStorageKey,
  nextQuickBooksSyncSort,
  parseQuickBooksSyncPageSize,
  persistQuickBooksSyncPageSize,
  QUICKBOOKS_SYNC_PAGE_SIZES,
  readQuickBooksSyncPageSize,
  type QuickBooksSyncPageSize,
  type QuickBooksSyncSort,
  type QuickBooksSyncSortDirection,
} from '@/lib/quickBooksSyncConsole';

type QueueView = 'all' | 'unsynced' | 'queued' | 'failed' | 'synced';
type TypeFilter = 'all' | 'invoice' | 'payment';
type EligibilityFilter = 'all' | 'queueable' | 'syncable' | 'blocked';
type ErrorFilter = 'all' | 'has_error' | 'no_error';
type QueueItem = {
  id: string;
  resourceType: 'invoice' | 'payment';
  displayNumber: string;
  customerName: string | null;
  amountCents: number;
  status: string;
  syncStatus: string;
  queueState: Exclude<QueueView, 'all'>;
  updatedAt: string;
  eligible: boolean;
  canTransmit: boolean;
  eligibility: Exclude<EligibilityFilter, 'all'>;
  ineligibleReason: string | null;
  lastError: string | null;
};
type QueueResponse = { success: boolean; data: { items: QueueItem[]; total: number; totalCount: number; totalPages: number; page: number; pageSize: number } };
type QueueCountsResponse = { success: boolean; data: { invoices: Record<'unsynced' | 'pending' | 'failed' | 'synced', number>; payments: Record<'unsynced' | 'pending' | 'failed' | 'synced', number> } };

const keyOf = (item: Pick<QueueItem, 'id' | 'resourceType'>) => `${item.resourceType}:${item.id}`;
const views: Array<{ value: QueueView; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'unsynced', label: 'Eligible / Unsynced' },
  { value: 'queued', label: 'Queued' },
  { value: 'failed', label: 'Failed' },
  { value: 'synced', label: 'Synced' },
];
const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

export default function QuickBooksSyncQueuePage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { activeOrgId } = useActiveOrganizationRole({ enabled: Boolean(user) });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<QuickBooksSyncPageSize>(25);
  const [hydratedPageSizeKey, setHydratedPageSizeKey] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [view, setView] = useState<QueueView>('all');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [eligibilityFilter, setEligibilityFilter] = useState<EligibilityFilter>('all');
  const [errorFilter, setErrorFilter] = useState<ErrorFilter>('all');
  const [sortBy, setSortBy] = useState<QuickBooksSyncSort>('updatedAt');
  const [sortDir, setSortDir] = useState<QuickBooksSyncSortDirection>('desc');
  const [selected, setSelected] = useState<Map<string, QueueItem>>(new Map());
  const pageSizeStorageKey = useMemo(
    () => activeOrgId && user?.id ? getQuickBooksSyncPageSizeStorageKey(user.id, activeOrgId) : null,
    [activeOrgId, user?.id],
  );

  useEffect(() => {
    if (!pageSizeStorageKey) return;
    setPageSize(readQuickBooksSyncPageSize(pageSizeStorageKey));
    setPage(1);
    setHydratedPageSizeKey(pageSizeStorageKey);
  }, [pageSizeStorageKey]);

  useEffect(() => {
    if (!pageSizeStorageKey || hydratedPageSizeKey !== pageSizeStorageKey) return;
    persistQuickBooksSyncPageSize(pageSize, pageSizeStorageKey);
  }, [hydratedPageSizeKey, pageSize, pageSizeStorageKey]);

  const query = useQuery<QueueResponse>({
    queryKey: ['/api/integrations/quickbooks/queue/items', page, pageSize, search, view, typeFilter, eligibilityFilter, errorFilter, sortBy, sortDir],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize), view, search, type: typeFilter, eligibility: eligibilityFilter, error: errorFilter, sortBy, sortDir });
      const res = await fetch(`/api/integrations/quickbooks/queue/items?${params}`, { credentials: 'include' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Unable to load QuickBooks sync console');
      return data;
    },
  });
  const counts = useQuery<QueueCountsResponse>({
    queryKey: ['/api/integrations/quickbooks/queue'],
    queryFn: async () => {
      const res = await fetch('/api/integrations/quickbooks/queue', { credentials: 'include' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Unable to load queue counts');
      return data;
    },
  });

  useEffect(() => {
    const totalPages = query.data?.data.totalPages;
    if (typeof totalPages === 'number' && totalPages > 0 && page > totalPages) setPage(totalPages);
  }, [page, query.data?.data.totalPages]);

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['/api/integrations/quickbooks/queue/items'] });
    await queryClient.invalidateQueries({ queryKey: ['/api/integrations/quickbooks/queue'] });
  };
  const items = query.data?.data.items ?? [];
  const selectedItems = Array.from(selected.values());
  const selectedQueueable = selectedItems.filter((item) => item.queueState === 'unsynced' && item.eligible);
  const selectedTransmissible = selectedItems.filter((item) => item.canTransmit);
  const selectedCount = selected.size;
  const anyEligible = useMemo(() => items.some((item) => item.eligible), [items]);
  const totalCount = query.data?.data.totalCount ?? 0;
  const totalPages = query.data?.data.totalPages ?? 0;
  const displayedPageCount = Math.max(1, totalPages);
  const pageRange = getQuickBooksSyncPageRange(page, pageSize, totalCount);
  const activeDetailedFilterCount = [typeFilter, eligibilityFilter, errorFilter].filter((value) => value !== 'all').length;

  const enqueueSelected = useMutation({
    mutationFn: async (explicit?: Array<{ id: string; resourceType: 'invoice' | 'payment' }>) => {
      const res = await fetch('/api/integrations/quickbooks/queue/enqueue-selected', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: explicit ?? selectedQueueable }) });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Unable to queue selected records');
      return data.data as { queued: number; skipped: number; rejected: number };
    },
    onSuccess: async (result) => { setSelected(new Map()); await invalidate(); toast({ title: 'Accounting work queued', description: `${result.queued} queued, ${result.skipped} skipped, ${result.rejected} rejected. No QuickBooks transmission was performed.` }); },
    onError: (error: Error) => toast({ title: 'Queue update failed', description: error.message, variant: 'destructive' }),
  });
  const syncSelected = useMutation({
    mutationFn: async (explicit?: Array<{ id: string; resourceType: 'invoice' | 'payment' }>) => {
      const res = await fetch('/api/integrations/quickbooks/queue/sync-selected', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: explicit ?? selectedTransmissible }) });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Selected QuickBooks sync failed');
      return data.data as { synced: number; failed: number; skipped: number; rejected: number };
    },
    onSuccess: async (result) => { setSelected(new Map()); await invalidate(); toast({ title: 'Selected QuickBooks sync complete', description: `${result.synced} synced, ${result.failed} failed, ${result.skipped} waiting, ${result.rejected} rejected.` }); },
    onError: (error: Error) => toast({ title: 'QuickBooks sync failed', description: error.message, variant: 'destructive' }),
  });

  const toggle = (item: QueueItem) => setSelected((current) => {
    const next = new Map(current);
    const key = keyOf(item);
    if (next.has(key)) next.delete(key);
    else if (item.eligible) next.set(key, item);
    return next;
  });
  const selectPage = () => setSelected((current) => {
    const next = new Map(current);
    for (const item of items.filter((item) => item.eligible)) next.set(keyOf(item), item);
    return next;
  });
  const changeView = (next: QueueView) => { setView(next); setPage(1); };
  const clearDetailedFilters = () => { setTypeFilter('all'); setEligibilityFilter('all'); setErrorFilter('all'); setPage(1); };
  const changeSort = (requestedSort: QuickBooksSyncSort) => {
    const next = nextQuickBooksSyncSort(sortBy, sortDir, requestedSort);
    setSortBy(next.sortBy);
    setSortDir(next.sortDir);
    setPage(1);
  };
  const count = (key: 'unsynced' | 'pending' | 'failed' | 'synced') => (counts.data?.data.invoices[key] ?? 0) + (counts.data?.data.payments[key] ?? 0);

  const SortableHead = ({ field, children, className = '' }: { field: QuickBooksSyncSort; children: ReactNode; className?: string }) => {
    const active = sortBy === field;
    const Icon = !active ? ArrowUpDown : sortDir === 'asc' ? ArrowUp : ArrowDown;
    return <TableHead aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'} className={className}><Button type="button" variant="ghost" size="sm" className="-ml-3 h-8 px-3" onClick={() => changeSort(field)}>{children}<Icon className="ml-1 h-3.5 w-3.5" /></Button></TableHead>;
  };

  const renderPagination = (position: 'top' | 'bottom') => (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between" data-testid={`quickbooks-pagination-${position}`}>
      <div className="text-sm text-muted-foreground" aria-live="polite">{totalCount === 0 ? '0 records' : `${pageRange.start}–${pageRange.end} of ${totalCount} records`} · {selectedCount} selected</div>
      <div className="flex flex-wrap items-center gap-2">
        <Select value={String(pageSize)} onValueChange={(value) => { setPageSize(parseQuickBooksSyncPageSize(value)); setPage(1); }}>
          <SelectTrigger className="w-[132px]" aria-label={`Rows per page (${position})`}><SelectValue /></SelectTrigger>
          <SelectContent>{QUICKBOOKS_SYNC_PAGE_SIZES.map((size) => <SelectItem key={size} value={String(size)}>{size} per page</SelectItem>)}</SelectContent>
        </Select>
        <Button type="button" variant="outline" size="sm" disabled={query.isLoading || page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))} aria-label={`Previous accounting page (${position})`}><ChevronLeft className="h-4 w-4" />Previous</Button>
        <span className="min-w-[92px] text-center text-sm text-muted-foreground">Page {page} of {displayedPageCount}</span>
        <Button type="button" variant="outline" size="sm" disabled={query.isLoading || totalPages === 0 || page >= totalPages} onClick={() => setPage((current) => Math.min(displayedPageCount, current + 1))} aria-label={`Next accounting page (${position})`}>Next<ChevronRight className="h-4 w-4" /></Button>
      </div>
    </div>
  );

  return <div className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl font-semibold">QuickBooks Sync Console</h1><p className="mt-1 text-sm text-muted-foreground">Discover local accounting work first, queue it safely, then send bounded selections to QuickBooks.</p></div><Button asChild variant="outline"><Link to="/settings/integrations"><ArrowLeft className="mr-2 h-4 w-4" />Back to integrations</Link></Button></div>
    <div className="grid gap-3 sm:grid-cols-3">{([['Eligible / Unsynced', count('unsynced')], ['Queued', count('pending')], ['Failed / Action Required', count('failed')]] as const).map(([label, value]) => <Card key={label}><CardHeader className="py-4"><CardDescription>{label}</CardDescription><CardTitle>{value}</CardTitle></CardHeader></Card>)}</div>
    <Card><CardHeader><CardTitle>Local accounting sync work</CardTitle><CardDescription>Queueing is local and remains available while QuickBooks is disconnected. Sync now only transmits records that are already queued.</CardDescription></CardHeader><CardContent className="space-y-4">
      <div className="flex flex-wrap gap-2">{views.map((entry) => <Button key={entry.value} type="button" variant={view === entry.value ? 'default' : 'outline'} size="sm" onClick={() => changeView(entry.value)}>{entry.label}</Button>)}</div>
      <div className="flex flex-wrap items-center gap-2">
        <Input className="min-w-[240px] flex-1 sm:max-w-sm" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search invoice, job, customer, or payment reference" />
        <Select value={typeFilter} onValueChange={(value: TypeFilter) => { setTypeFilter(value); setPage(1); }}><SelectTrigger className="w-[140px]" aria-label="Record type filter"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All types</SelectItem><SelectItem value="invoice">Invoices</SelectItem><SelectItem value="payment">Payments</SelectItem></SelectContent></Select>
        <Select value={view} onValueChange={(value: QueueView) => changeView(value)}><SelectTrigger className="w-[145px]" aria-label="Queue state filter"><SelectValue /></SelectTrigger><SelectContent>{views.map((entry) => <SelectItem key={entry.value} value={entry.value}>{entry.label}</SelectItem>)}</SelectContent></Select>
        <Select value={eligibilityFilter} onValueChange={(value: EligibilityFilter) => { setEligibilityFilter(value); setPage(1); }}><SelectTrigger className="w-[150px]" aria-label="Eligibility filter"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All eligibility</SelectItem><SelectItem value="queueable">Queueable</SelectItem><SelectItem value="syncable">Syncable</SelectItem><SelectItem value="blocked">Blocked / waiting</SelectItem></SelectContent></Select>
        <Select value={errorFilter} onValueChange={(value: ErrorFilter) => { setErrorFilter(value); setPage(1); }}><SelectTrigger className="w-[130px]" aria-label="Error filter"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All errors</SelectItem><SelectItem value="has_error">Has error</SelectItem><SelectItem value="no_error">No error</SelectItem></SelectContent></Select>
        {activeDetailedFilterCount > 0 && <Button variant="ghost" size="sm" onClick={clearDetailedFilters}><X className="mr-1 h-4 w-4" />Clear filters ({activeDetailedFilterCount})</Button>}
      </div>
      <div className="flex flex-wrap items-center gap-2"><Button variant="outline" onClick={selectPage} disabled={!anyEligible}>Select eligible on this page</Button><Button variant="ghost" onClick={() => setSelected(new Map())} disabled={!selectedCount}>Clear selection</Button><Button variant="outline" onClick={() => enqueueSelected.mutate(undefined)} disabled={!selectedQueueable.length || enqueueSelected.isPending}><ListPlus className="mr-2 h-4 w-4" />Queue Selected ({selectedQueueable.length})</Button><Button onClick={() => syncSelected.mutate(undefined)} disabled={!selectedTransmissible.length || syncSelected.isPending}><RefreshCw className={`mr-2 h-4 w-4 ${syncSelected.isPending ? 'animate-spin' : ''}`} />Sync Selected ({selectedTransmissible.length})</Button></div>
      {renderPagination('top')}
      {query.isLoading ? <div className="py-8 text-sm text-muted-foreground">Loading local accounting work…</div> : query.isError ? <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/5 p-4 text-sm"><p className="font-medium text-destructive">Unable to load local accounting work.</p><p className="mt-1 text-muted-foreground">{query.error instanceof Error ? query.error.message : 'Please retry the request.'}</p><Button className="mt-3" size="sm" variant="outline" onClick={() => query.refetch()}>Retry</Button></div> : <div className="overflow-x-auto rounded-md border"><Table>
        <TableHeader><TableRow><TableHead className="w-12">Select</TableHead><SortableHead field="record">Record</SortableHead><SortableHead field="customer">Customer</SortableHead><SortableHead field="type">Type</SortableHead><SortableHead field="state">State</SortableHead><SortableHead field="eligibility">Eligibility</SortableHead><SortableHead field="amount" className="text-right">Amount</SortableHead><SortableHead field="updatedAt">Updated</SortableHead><TableHead>Error</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader>
        <TableBody>{items.map((item) => <TableRow key={keyOf(item)}><TableCell><input aria-label={`Select ${item.displayNumber}`} type="checkbox" checked={selected.has(keyOf(item))} disabled={!item.eligible} onChange={() => toggle(item)} /></TableCell><TableCell className="font-medium">{item.displayNumber}</TableCell><TableCell>{item.customerName || '—'}</TableCell><TableCell className="capitalize">{item.resourceType}</TableCell><TableCell><Badge variant={item.queueState === 'failed' ? 'destructive' : item.queueState === 'unsynced' ? 'secondary' : 'outline'}>{item.queueState.replace('_', ' ')}</Badge></TableCell><TableCell>{item.eligibility === 'syncable' ? <Badge className="bg-green-600">Syncable</Badge> : item.eligibility === 'queueable' ? <Badge variant="secondary">Queueable</Badge> : <span className="text-xs text-muted-foreground">{item.ineligibleReason || 'Blocked'}</span>}</TableCell><TableCell className="text-right tabular-nums">{currency.format(item.amountCents / 100)}</TableCell><TableCell className="whitespace-nowrap text-xs text-muted-foreground">{new Date(item.updatedAt).toLocaleDateString()}</TableCell><TableCell className="max-w-xs text-xs text-muted-foreground">{item.lastError || '—'}</TableCell><TableCell className="text-right">{item.queueState === 'unsynced' ? <Button size="sm" variant="outline" disabled={!item.eligible || enqueueSelected.isPending} onClick={() => enqueueSelected.mutate([{ id: item.id, resourceType: item.resourceType }])}>Queue</Button> : <Button size="sm" variant="outline" disabled={!item.canTransmit || syncSelected.isPending} onClick={() => syncSelected.mutate([{ id: item.id, resourceType: item.resourceType }])}>Sync now</Button>}</TableCell></TableRow>)}{!items.length && <TableRow><TableCell colSpan={10} className="py-8 text-center text-muted-foreground">No local QuickBooks accounting records match this view.</TableCell></TableRow>}</TableBody>
      </Table></div>}
      {renderPagination('bottom')}
    </CardContent></Card>
  </div>;
}
