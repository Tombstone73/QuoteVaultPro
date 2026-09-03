import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ListPlus, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';

type QueueView = 'all' | 'unsynced' | 'queued' | 'failed' | 'synced';
type QueueItem = { id: string; resourceType: 'invoice' | 'payment'; displayNumber: string; status: string; syncStatus: string; queueState: Exclude<QueueView, 'all'>; updatedAt: string; eligible: boolean; canTransmit: boolean; ineligibleReason: string | null; lastError: string | null };
type QueueResponse = { success: boolean; data: { items: QueueItem[]; total: number; page: number; pageSize: number } };
type QueueCountsResponse = { success: boolean; data: { invoices: Record<'unsynced' | 'pending' | 'failed' | 'synced', number>; payments: Record<'unsynced' | 'pending' | 'failed' | 'synced', number> } };
const keyOf = (item: Pick<QueueItem, 'id' | 'resourceType'>) => `${item.resourceType}:${item.id}`;
const views: Array<{ value: QueueView; label: string }> = [{ value: 'all', label: 'All' }, { value: 'unsynced', label: 'Eligible / Unsynced' }, { value: 'queued', label: 'Queued' }, { value: 'failed', label: 'Failed' }, { value: 'synced', label: 'Synced' }];

export default function QuickBooksSyncQueuePage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [view, setView] = useState<QueueView>('all');
  const [selected, setSelected] = useState<Map<string, QueueItem>>(new Map());
  const query = useQuery<QueueResponse>({ queryKey: ['/api/integrations/quickbooks/queue/items', page, search, view], queryFn: async () => {
    const res = await fetch(`/api/integrations/quickbooks/queue/items?page=${page}&pageSize=25&view=${view}&search=${encodeURIComponent(search)}`, { credentials: 'include' });
    const data = await res.json(); if (!res.ok || !data.success) throw new Error(data.error || 'Unable to load QuickBooks sync console'); return data;
  }});
  const counts = useQuery<QueueCountsResponse>({ queryKey: ['/api/integrations/quickbooks/queue'], queryFn: async () => {
    const res = await fetch('/api/integrations/quickbooks/queue', { credentials: 'include' }); const data = await res.json(); if (!res.ok || !data.success) throw new Error(data.error || 'Unable to load queue counts'); return data;
  }});
  const invalidate = async () => { await queryClient.invalidateQueries({ queryKey: ['/api/integrations/quickbooks/queue/items'] }); await queryClient.invalidateQueries({ queryKey: ['/api/integrations/quickbooks/queue'] }); };
  const items = query.data?.data.items ?? [];
  const selectedItems = Array.from(selected.values());
  const selectedQueueable = selectedItems.filter((item) => item.queueState === 'unsynced');
  const selectedTransmissible = selectedItems.filter((item) => ['queued', 'failed'].includes(item.queueState));
  const selectedCount = selected.size;
  const anyEligible = useMemo(() => items.some((item) => item.eligible), [items]);
  const enqueueSelected = useMutation({ mutationFn: async (explicit?: Array<{ id: string; resourceType: 'invoice' | 'payment' }>) => {
    const res = await fetch('/api/integrations/quickbooks/queue/enqueue-selected', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: explicit ?? selectedQueueable }) });
    const data = await res.json(); if (!res.ok || !data.success) throw new Error(data.error || 'Unable to queue selected records'); return data.data as { queued: number; skipped: number; rejected: number };
  }, onSuccess: async (result) => { setSelected(new Map()); await invalidate(); toast({ title: 'Accounting work queued', description: `${result.queued} queued, ${result.skipped} skipped, ${result.rejected} rejected. No QuickBooks transmission was performed.` }); }, onError: (error: Error) => toast({ title: 'Queue update failed', description: error.message, variant: 'destructive' }) });
  const syncSelected = useMutation({ mutationFn: async (explicit?: Array<{ id: string; resourceType: 'invoice' | 'payment' }>) => {
    const res = await fetch('/api/integrations/quickbooks/queue/sync-selected', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: explicit ?? selectedTransmissible }) });
    const data = await res.json(); if (!res.ok || !data.success) throw new Error(data.error || 'Selected QuickBooks sync failed'); return data.data as { synced: number; failed: number; skipped: number; rejected: number };
  }, onSuccess: async (result) => { setSelected(new Map()); await invalidate(); toast({ title: 'Selected QuickBooks sync complete', description: `${result.synced} synced, ${result.failed} failed, ${result.skipped} waiting, ${result.rejected} rejected.` }); }, onError: (error: Error) => toast({ title: 'QuickBooks sync failed', description: error.message, variant: 'destructive' }) });
  const toggle = (item: QueueItem) => setSelected((current) => { const next = new Map(current); const key = keyOf(item); if (next.has(key)) next.delete(key); else if (item.eligible) next.set(key, item); return next; });
  const selectPage = () => setSelected((current) => { const next = new Map(current); for (const item of items.filter((item) => item.eligible)) next.set(keyOf(item), item); return next; });
  const switchView = (next: QueueView) => { setView(next); setPage(1); setSelected(new Map()); };
  const count = (key: 'unsynced' | 'pending' | 'failed' | 'synced') => (counts.data?.data.invoices[key] ?? 0) + (counts.data?.data.payments[key] ?? 0);
  return <div className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl font-semibold">QuickBooks Sync Console</h1><p className="mt-1 text-sm text-muted-foreground">Discover local accounting work first, queue it safely, then send bounded selections to QuickBooks.</p></div><Button asChild variant="outline"><Link to="/settings/integrations"><ArrowLeft className="mr-2 h-4 w-4" />Back to integrations</Link></Button></div>
    <div className="grid gap-3 sm:grid-cols-3">{[['Eligible / Unsynced', count('unsynced')], ['Queued', count('pending')], ['Failed / Action Required', count('failed')]].map(([label, value]) => <Card key={String(label)}><CardHeader className="py-4"><CardDescription>{label}</CardDescription><CardTitle>{value}</CardTitle></CardHeader></Card>)}</div>
    <Card><CardHeader><CardTitle>Local accounting sync work</CardTitle><CardDescription>Queueing is local and remains available while QuickBooks is disconnected. Sync now only transmits records that are already queued.</CardDescription></CardHeader><CardContent className="space-y-4">
      <div className="flex flex-wrap gap-2">{views.map((entry) => <Button key={entry.value} type="button" variant={view === entry.value ? 'default' : 'outline'} size="sm" onClick={() => switchView(entry.value)}>{entry.label}</Button>)}</div>
      <div className="flex flex-wrap items-center gap-2"><Input className="max-w-sm" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search invoice, job, customer, or payment reference" /><Button variant="outline" onClick={selectPage} disabled={!anyEligible}>Select eligible on this page</Button><Button variant="ghost" onClick={() => setSelected(new Map())} disabled={!selectedCount}>Clear selection</Button><Button variant="outline" onClick={() => enqueueSelected.mutate()} disabled={!selectedQueueable.length || enqueueSelected.isPending}><ListPlus className="mr-2 h-4 w-4" />Queue Selected ({selectedQueueable.length})</Button><Button onClick={() => syncSelected.mutate()} disabled={!selectedTransmissible.length || syncSelected.isPending}><RefreshCw className={`mr-2 h-4 w-4 ${syncSelected.isPending ? 'animate-spin' : ''}`} />Sync Selected ({selectedTransmissible.length})</Button></div>
      {query.isLoading ? <div className="py-8 text-sm text-muted-foreground">Loading local accounting work…</div> : <div className="overflow-x-auto rounded-md border"><Table><TableHeader><TableRow><TableHead className="w-12">Select</TableHead><TableHead>Record</TableHead><TableHead>Type</TableHead><TableHead>State</TableHead><TableHead>Eligibility</TableHead><TableHead>Error</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader><TableBody>{items.map((item) => <TableRow key={keyOf(item)}><TableCell><input aria-label={`Select ${item.displayNumber}`} type="checkbox" checked={selected.has(keyOf(item))} disabled={!item.eligible} onChange={() => toggle(item)} /></TableCell><TableCell className="font-medium">{item.displayNumber}</TableCell><TableCell className="capitalize">{item.resourceType}</TableCell><TableCell><Badge variant={item.queueState === 'failed' ? 'destructive' : item.queueState === 'unsynced' ? 'secondary' : 'outline'}>{item.queueState.replace('_', ' ')}</Badge></TableCell><TableCell>{item.eligible ? <Badge className="bg-green-600">{item.canTransmit ? 'Ready' : item.queueState === 'unsynced' ? 'Queueable' : 'Waiting'}</Badge> : <span className="text-xs text-muted-foreground">{item.ineligibleReason}</span>}</TableCell><TableCell className="max-w-xs text-xs text-muted-foreground">{item.lastError || '—'}</TableCell><TableCell className="text-right">{item.queueState === 'unsynced' ? <Button size="sm" variant="outline" disabled={!item.eligible || enqueueSelected.isPending} onClick={() => enqueueSelected.mutate([{ id: item.id, resourceType: item.resourceType }])}>Queue</Button> : <Button size="sm" variant="outline" disabled={!item.canTransmit || syncSelected.isPending} onClick={() => syncSelected.mutate([{ id: item.id, resourceType: item.resourceType }])}>Sync now</Button>}</TableCell></TableRow>)}{!items.length && <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">No local QuickBooks accounting records match this view.</TableCell></TableRow>}</TableBody></Table></div>}
      <div className="flex items-center justify-between text-sm"><span>{query.data?.data.total ?? 0} matching records · {selectedCount} selected</span><div className="flex gap-2"><Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</Button><Button variant="outline" size="sm" disabled={items.length < 25} onClick={() => setPage((value) => value + 1)}>Next</Button></div></div>
    </CardContent></Card>
  </div>;
}
