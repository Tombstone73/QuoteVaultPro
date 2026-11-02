import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
import { gmailAcknowledgementLabels, type GmailAcknowledgementView } from '@shared/inboundGmailAcknowledgement';

const key=['/api/inbound-orders/gmail-acknowledgements'];
export function InboundGmailAcknowledgementStatus({onOpenRecord}:{onOpenRecord:(id:string)=>void}) {
  const client=useQueryClient();
  const query=useQuery<{enabled:boolean;jobs:GmailAcknowledgementView[]}>({queryKey:key,
    queryFn:async()=>(await apiRequest('GET',key[0])).json(),refetchInterval:10_000});
  const retry=useMutation({mutationFn:async(id:string)=>(await apiRequest('POST',`${key[0]}/${encodeURIComponent(id)}/retry`,{})).json(),
    onSuccess:()=>client.invalidateQueries({queryKey:key})});
  if(query.isError)return <p role="status" className="mt-2 text-sm text-muted-foreground">Gmail update status is unavailable. Committed Orders are unchanged.</p>;
  if(!query.data?.jobs.length)return null;
  return <section aria-label="Gmail Order acknowledgements" className="mt-3 rounded-md border p-3 text-sm">
    <h3 className="font-medium">Gmail updates for entered Orders</h3>
    {!query.data.enabled&&<p>Gmail writes are paused. Queued updates are retained.</p>}
    <p>Gmail synchronization is separate from Order creation and new evidence review.</p>
    {query.data.jobs.map(job=><div key={job.id} role="status" className="mt-2 flex flex-wrap items-center gap-2 border-t pt-2">
      <div><p>{gmailAcknowledgementLabels[job.status]}</p>{job.message&&<p className="text-muted-foreground">{job.message}</p>}</div>
      <Button type="button" variant="outline" size="sm" onClick={()=>onOpenRecord(job.inboundRecordId)}>Open inbound request</Button>
      {job.status==='reconnect_required'&&<a href="/settings/email" className="underline">Open mailbox settings</a>}
      {job.canRetry&&<Button type="button" variant="outline" size="sm" disabled={retry.isPending} onClick={()=>retry.mutate(job.id)}>Retry Gmail update</Button>}
    </div>)}
    {retry.isError&&<p className="text-destructive">Gmail retry could not be queued. Refresh its state; the Order is unchanged.</p>}
  </section>;
}
