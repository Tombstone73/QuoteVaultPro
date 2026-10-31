import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
import { inboundEmailImportLabels, type InboundEmailImportView } from '@shared/inboundEmailImport';

const key = ['/api/inbound-orders/email-imports'];
export function InboundEmailImportStatus({ onOpenRecord }: {onOpenRecord?: (recordId:string)=>void}) {
  const client = useQueryClient();
  const query = useQuery<{ success: true; data: { enabled: boolean; jobs: InboundEmailImportView[] } }>({
    queryKey: key, queryFn: async () => (await apiRequest('GET', key[0])).json(),
    refetchInterval: current => current.state.data?.data.jobs.some(job=>['waiting','importing','retrying'].includes(job.status)) ? 5_000 : 30_000,
  });
  const retry = useMutation({
    mutationFn: async (jobId: string) => (await apiRequest('POST', `${key[0]}/${encodeURIComponent(jobId)}/retry`, {})).json(),
    onSuccess: async () => { await client.invalidateQueries({ queryKey: key }); },
  });
  const previous = useRef<InboundEmailImportView[]>([]);
  const jobs = query.data?.data.jobs;
  useEffect(() => {
    if (!jobs) return;
    const pending = new Set(jobs.map(job => job.id));
    for (const finished of previous.current.filter(job => !pending.has(job.id))) {
      // Refresh persisted evidence visibility only; never replace unsaved staff draft edits.
      if (finished.inboundRecordId) void client.invalidateQueries({ queryKey: ['/api/inbound-orders', finished.inboundRecordId], exact: true });
      void client.invalidateQueries({ predicate:query=>query.queryKey[0]==='/api/inbound-orders' && (query.queryKey.length===1 || typeof query.queryKey[1]==='object') });
    }
    previous.current = jobs;
  }, [client, jobs]);
  if (query.isError) return <p role="status" className="mt-2 text-sm text-muted-foreground">Email import recovery status is unavailable. Refresh to check retained work.</p>;
  if (!jobs?.length) return null;
  return <section aria-label="Email import recovery" className="mt-3 rounded-md border p-3 text-sm">
    <h3 className="font-medium">Email import progress</h3>
    {!query.data?.data.enabled && <p className="text-muted-foreground">Background import recovery is paused. Retry import queues work but cannot run until recovery resumes. Open the inbound request to parse available evidence manually.</p>}
    <p className="text-muted-foreground">AI can prepare an incomplete review draft from available evidence. Unresolved attachments still block approval.</p>
    {jobs.map(job => <div key={job.id} className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t pt-2" role="status">
      <div><p>{inboundEmailImportLabels[job.status]}{job.workKind==='discovery' ? ' · Mailbox discovery' : job.inboundRecordId ? ' · Linked inbound request' : ' · Discovered message'}</p>
        {job.message && <p className="text-muted-foreground">{job.message}</p>}
        {job.status === 'retrying' && <p className="text-muted-foreground">Retry after {new Date(job.nextAttemptAt).toLocaleString()}.</p>}
      </div>
      {job.inboundRecordId && onOpenRecord && <Button type="button" size="sm" variant="outline" onClick={()=>onOpenRecord(job.inboundRecordId!)}>Open inbound request</Button>}
      {job.canRetry && <Button type="button" size="sm" variant="outline" disabled={retry.isPending} onClick={() => retry.mutate(job.id)}>{query.data?.data.enabled ? 'Retry import' : 'Queue import retry'}</Button>}
    </div>)}
    {retry.isError && <p className="text-destructive">Retry could not be queued. Refresh and review the import state.</p>}
  </section>;
}
