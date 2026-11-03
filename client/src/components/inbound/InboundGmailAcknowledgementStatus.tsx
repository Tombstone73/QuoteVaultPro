import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { InboundStatusDisclosure } from './InboundStatusDisclosure';
import { Button } from '@/components/ui/button';
import { gmailAcknowledgementLabels, type GmailAcknowledgementRollout, type GmailAcknowledgementView } from '@shared/inboundGmailAcknowledgement';

const key=['/api/inbound-orders/gmail-acknowledgements'];
export function InboundGmailAcknowledgementStatus({onOpenRecord}:{onOpenRecord:(id:string)=>void}) {
  const client=useQueryClient();
  const [history, setHistory] = useState(false);
  const query=useQuery<{enabled:boolean;rollout?:GmailAcknowledgementRollout;counts?:{pending:number;failed:number};jobs:GmailAcknowledgementView[]}>({queryKey:[...key, history],
    queryFn:async()=>(await apiRequest('GET',`${key[0]}${history ? '?history=true' : ''}`)).json(),placeholderData: previous => previous,refetchInterval:10_000});
  const retry=useMutation({mutationFn:async(id:string)=>(await apiRequest('POST',`${key[0]}/${encodeURIComponent(id)}/retry`,{})).json(),
    onSuccess:()=>client.invalidateQueries({queryKey:key})});
  if(!query.data && !query.isError)return null;
  const jobs = query.data?.jobs ?? [];
  const counts = query.data?.counts ?? {
    pending: jobs.filter(job => ['waiting','processing','retrying'].includes(job.status)).length,
    failed: jobs.filter(job => ['failed','reconnect_required','needs_attention'].includes(job.status)).length,
  };
  const summary = `${query.isError ? 'Status unavailable' : query.data?.enabled ? 'Active' : 'Paused'} \u00b7 ${query.data ? `${counts.pending} pending${counts.failed ? ` \u00b7 ${counts.failed} need attention` : ''}` : 'Counts unavailable'}`;
  return <InboundStatusDisclosure preferenceKey="titanos.inboundOrders.gmailAcknowledgementsExpanded" title="Gmail updates" summary={summary}>
    {query.isError && <p role="alert">Gmail update status is unavailable. Committed Orders are unchanged. Previously loaded counts may be outdated.</p>}
    {query.data && !query.data.enabled&&<p>{query.data.rollout?.message ?? 'Gmail writes are paused. Queued updates are retained.'}</p>}
    <p>Gmail synchronization is separate from Order creation and new evidence review.</p>
    <Button type="button" variant="outline" size="sm" aria-pressed={history} onClick={()=>setHistory(!history)}>{history ? 'Show pending Gmail updates' : 'Show Gmail acknowledgement history'}</Button>
    {query.data && !jobs.length && <p>{history ? 'No Gmail acknowledgement history is available.' : 'No pending Gmail updates.'}</p>}
    {jobs.length === 100 && <p>Showing up to 100 recent updates. Summary counts include all retained updates.</p>}
    {jobs.map(job=><div key={job.id} role="status" className="mt-2 flex flex-wrap items-center gap-2 border-t pt-2">
      <div><p className="font-medium">{job.orderNumber ? `Order ${job.orderNumber} created` : 'Linked Order'}</p><p>{gmailAcknowledgementLabels[job.status]}</p>{job.message&&<p className="text-muted-foreground">{job.message}</p>}</div>
      <a className="font-medium underline focus-visible:outline focus-visible:outline-2" href={`/orders/${encodeURIComponent(job.orderId)}`}>View Order</a>
      <Button type="button" variant="outline" size="sm" onClick={()=>onOpenRecord(job.inboundRecordId)}>Open inbound request</Button>
      {job.status==='reconnect_required'&&<a href="/settings/email" className="underline">Open mailbox settings</a>}
      {job.canRetry&&<Button type="button" variant="outline" size="sm" disabled={retry.isPending} onClick={()=>retry.mutate(job.id)}>Retry Gmail update</Button>}
    </div>)}
    {retry.isError&&<p className="text-destructive">Gmail retry could not be queued. Refresh its state; the Order is unchanged.</p>}
  </InboundStatusDisclosure>;
}
