import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';

type QueueItem = { id: string; resourceType: 'invoice' | 'payment'; displayNumber: string; status: string; syncStatus: string; updatedAt: string; eligible: boolean; ineligibleReason: string | null; lastError: string | null };
type QueueResponse = { success: boolean; data: { items: QueueItem[]; total: number; page: number; pageSize: number } };
const keyOf = (item: Pick<QueueItem, 'id' | 'resourceType'>) => `${item.resourceType}:${item.id}`;

export default function QuickBooksSyncQueuePage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Map<string, Pick<QueueItem, 'id' | 'resourceType'>>>(new Map());
  const query = useQuery<QueueResponse>({ queryKey: ['/api/integrations/quickbooks/queue/items', page, search], queryFn: async () => {
    const res = await fetch(`/api/integrations/quickbooks/queue/items?page=${page}&pageSize=25&search=${encodeURIComponent(search)}`, { credentials: 'include' });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'Unable to load QuickBooks sync queue');
    return data;
  }});
  const items = query.data?.data.items ?? [];
  const selectedCount = selected.size;
  const eligiblePageItems = useMemo(() => items.filter((item) => item.eligible), [items]);
  const allEligiblePageSelected = eligiblePageItems.length > 0 && eligiblePageItems.every((item) => selected.has(keyOf(item)));

  const syncSelected = useMutation({ mutationFn: async (explicitItems?: Array<{ id: string; resourceType: 'invoice' | 'payment' }>) => {
    const res = await fetch('/api/integrations/quickbooks/queue/sync-selected', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: explicitItems ?? Array.from(selected.values()) }) });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'Selected QuickBooks sync failed');
    return data.data as { synced: number; failed: number; skipped: number; rejected: number };
  }, onSuccess: async (result) => {
    setSelected(new Map());
    await queryClient.invalidateQueries({ queryKey: ['/api/integrations/quickbooks/queue/items'] });
    await queryClient.invalidateQueries({ queryKey: ['/api/integrations/quickbooks/queue'] });
    toast({ title: 'Selected QuickBooks sync complete', description: `${result.synced} synced, ${result.failed} failed, ${result.skipped} skipped, ${result.rejected} rejected.` });
  }, onError: (error: Error) => toast({ title: 'QuickBooks sync failed', description: error.message, variant: 'destructive' }) });

  const toggle = (item: QueueItem) => setSelected((current) => {
    const next = new Map(current); const key = keyOf(item);
    if (next.has(key)) next.delete(key); else if (item.eligible) next.set(key, { id: item.id, resourceType: item.resourceType });
    return next;
  });
  const selectPage = () => setSelected((current) => {
    const next = new Map(current);
    for (const item of eligiblePageItems) next.set(keyOf(item), { id: item.id, resourceType: item.resourceType });
    return next;
  });

  return <div className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-2xl font-semibold">QuickBooks Sync Queue</h1><p className="text-sm text-muted-foreground mt-1">Select specific eligible invoice or payment sync units. Unselected records are never included.</p></div>
      <Button asChild variant="outline"><Link to="/settings/integrations"><ArrowLeft className="w-4 h-4 mr-2" />Back to integrations</Link></Button>
    </div>
    <Card><CardHeader><CardTitle>Pending and failed sync units</CardTitle><CardDescription>Selection is retained across pages for this queue session. The background worker remains available separately for bounded queue processing.</CardDescription></CardHeader><CardContent className="space-y-4">
      <div className="flex flex-wrap gap-2 items-center"><Input className="max-w-sm" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search invoice or payment" />
        <Button variant="outline" onClick={selectPage} disabled={!eligiblePageItems.length || allEligiblePageSelected}>Select all eligible on this page</Button>
        <Button variant="ghost" onClick={() => setSelected(new Map())} disabled={!selectedCount}>Clear selection</Button>
        <Button onClick={() => syncSelected.mutate()} disabled={!selectedCount || syncSelected.isPending}><RefreshCw className={`w-4 h-4 mr-2 ${syncSelected.isPending ? 'animate-spin' : ''}`} />Sync Selected ({selectedCount})</Button>
      </div>
      {query.isLoading ? <div className="py-8 text-sm text-muted-foreground">Loading queue…</div> : <div className="rounded-md border overflow-x-auto"><Table><TableHeader><TableRow><TableHead className="w-12">Select</TableHead><TableHead>Record</TableHead><TableHead>Type</TableHead><TableHead>Status</TableHead><TableHead>Eligibility</TableHead><TableHead>Error</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader><TableBody>{items.map((item) => <TableRow key={keyOf(item)}><TableCell><input aria-label={`Select ${item.displayNumber}`} type="checkbox" checked={selected.has(keyOf(item))} disabled={!item.eligible} onChange={() => toggle(item)} /></TableCell><TableCell className="font-medium">{item.displayNumber}</TableCell><TableCell className="capitalize">{item.resourceType}</TableCell><TableCell><Badge variant={item.syncStatus === 'failed' ? 'destructive' : 'outline'}>{item.syncStatus}</Badge></TableCell><TableCell>{item.eligible ? <Badge className="bg-green-600">Eligible</Badge> : <span className="text-xs text-muted-foreground">{item.ineligibleReason}</span>}</TableCell><TableCell className="max-w-xs text-xs text-muted-foreground">{item.lastError || '—'}</TableCell><TableCell className="text-right"><Button size="sm" variant="outline" disabled={!item.eligible || syncSelected.isPending} onClick={() => syncSelected.mutate([{ id: item.id, resourceType: item.resourceType }])}>Sync now</Button></TableCell></TableRow>)}{!items.length && <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">No pending or failed QuickBooks sync units match this view.</TableCell></TableRow>}</TableBody></Table></div>}
      <div className="flex items-center justify-between text-sm"><span>{query.data?.data.total ?? 0} matching records · {selectedCount} selected</span><div className="flex gap-2"><Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</Button><Button variant="outline" size="sm" disabled={items.length < 25} onClick={() => setPage((value) => value + 1)}>Next</Button></div></div>
    </CardContent></Card>
  </div>;
}
