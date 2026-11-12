import { useAuth } from '@/hooks/useAuth';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/queryClient';
import { directPrintRecoveryGuidance, directPrintStatusLabel, type DirectPrintJobStatus } from '@shared/directPrintJobStatus';
import { productionLabelModeNames } from '@shared/productionItemLabels';

export function DirectPrintJobDiagnostics({jobIds}:{jobIds?:string[]}) {
  const { user } = useAuth();
  const query=useQuery<DirectPrintJobStatus[]>({queryKey:['direct-print-job-status',user?.lastActiveOrgId,user?.id,jobIds??'recent'],
    enabled:!!user&&(!jobIds||jobIds.length>0),refetchInterval:5000,
    queryFn:async({signal})=>{
      const response=await apiFetch(jobIds?`/api/direct-print/jobs/status?ids=${encodeURIComponent(jobIds.join(','))}`:'/api/printer-profiles/print-jobs',{signal});
      const body=await response.json();if(!response.ok||!Array.isArray(body.data))throw new Error('Print status could not be loaded. Do not assume printing completed.');return body.data;
    }});
  return <section aria-label="Print delivery status" className="space-y-2 text-sm">
    {query.isLoading&&<p role="status">Loading print-job status…</p>}
    {query.error&&<p role="alert">Print status is unavailable. Check the agent log before retrying.</p>}
    <div className="max-h-64 space-y-2 overflow-y-auto">{query.data?.map(job=><article key={job.id} className="rounded border bg-card p-3">
      <p className="font-semibold">{job.orderNumber?`Order ${job.orderNumber} · `:''}{job.documentType.replaceAll('_',' ')} · {directPrintStatusLabel(job.status)}</p>
      <p className="break-all">Job {job.id}</p><p>Assigned: {job.machineLabel||job.agentName||job.agentId} · {job.destinationName} · Configured Windows queue: {job.queueName||'Unavailable'}</p>
      {job.productionLabels && <>
        <p>{productionLabelModeNames[job.productionLabels.mode]} · {job.productionLabels.labelCount} labels · {job.productionLabels.lines.map(line => "Line " + line.lineNumber + " (" + line.labelCount + ")").join(" · ")}</p>
        {job.requestedByUserId && <p className="break-words">Requested by staff {job.requestedByUserId}</p>}
      </>}
      <p>Queued {new Date(job.createdAt).toLocaleString()}{job.claimedAt?` · Claimed ${new Date(job.claimedAt).toLocaleString()}`:''}{job.submittedAt?` · Windows submission ${new Date(job.submittedAt).toLocaleString()}`:''}</p>
      <p>Last activity: {new Date(job.updatedAt).toLocaleString()}</p>
      {job.lastError&&<p role="alert" className="break-words text-destructive">{job.lastError}</p>}
      <p>{directPrintRecoveryGuidance(job.status)}</p>
    </article>)}</div>
    {!query.isLoading&&!query.error&&query.data?.length===0&&<p>No matching print jobs in the latest history.</p>}
    {!jobIds&&<p className="text-xs text-muted-foreground">Latest 50 jobs. Shipment jobs show their primary Order; combined-shipment associations remain in Shipping History.</p>}
  </section>;
}
