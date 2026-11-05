import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

type Report = {
  readOnly: true; mutationAvailable: false; observedAt: string; snapshotToken: string;
  order: { id: string; orderNumber: string | null; poNumber: string | null };
  canonicalPreview: { remainingProductionQuantity: number; remainingFulfillmentQuantity: number; activeProductionJobCount: number; productionBootstrapLineCount: number };
  findings: Array<{ code: string; message: string; lineItemId: string | null }>;
};

async function loadReport(path: string, signal: AbortSignal): Promise<Report> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal.addEventListener('abort', cancel, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error('Read-only diagnostic timed out. Retry the report; no repair was attempted.')); }, 20_000);
    });
    const result = await Promise.race([
      apiRequest('GET', path, undefined, { signal: controller.signal, cache: 'no-store' }).then(response => response.json()), timeout,
    ]);
    if (!result?.success || result.data?.readOnly !== true || result.data?.mutationAvailable !== false || !result.data?.snapshotToken)
      throw new Error('A complete read-only diagnostic was not returned. Retry the report.');
    return result.data as Report;
  } finally {
    clearTimeout(timer); signal.removeEventListener('abort', cancel);
  }
}

/** Reports are memory-only and loaded deliberately by the active tenant Owner. */
export function OrderReconciliationDiagnostic({ orderId, orderNumber, poNumber, organizationId, isOwner, className }: {
  orderId: string; orderNumber?: string | null; poNumber?: string | null;
  organizationId: string; isOwner: boolean; className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [copyStatus, setCopyStatus] = useState('');
  const params = new URLSearchParams();
  if (orderNumber) params.set('expectedOrderNumber', orderNumber);
  if (poNumber) params.set('expectedPoNumber', poNumber);
  const report = useQuery({
    queryKey: ['order-reconciliation-diagnostic', organizationId, orderId, orderNumber, poNumber],
    enabled: open && isOwner, retry: false, staleTime: 0, gcTime: 0,
    refetchOnWindowFocus: false, refetchOnReconnect: false,
    queryFn: ({ signal }) => loadReport(`/api/orders/${orderId}/reconciliation-diagnostic?${params}`, signal),
  });
  if (!isOwner) return null;
  const text = report.data ? JSON.stringify(report.data, null, 2) : '';
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopyStatus('Diagnostic copied. It contains private Order information; share only with authorized staff.'); }
    catch { setCopyStatus('Copy was unavailable. Select the report text and copy it manually.'); }
  };
  return <>
    <Button type="button" variant="outline" size="sm" className={className} onClick={() => { setCopyStatus(''); setOpen(true); }}>Order diagnostic</Button>
    <Dialog open={open} onOpenChange={value => { setOpen(value); setCopyStatus(''); }}>
      <DialogContent className="flex max-h-[90dvh] max-w-3xl flex-col overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Read-only diagnostic · Order {orderNumber || orderId}</DialogTitle>
          <DialogDescription>Owner-only record snapshot. This report cannot change production, fulfillment, or financial records. Findings require review; no repair is offered.</DialogDescription>
        </DialogHeader>
        {report.isFetching ? <p role="status">Retrieving a consistent read-only snapshot…</p> : null}
        {report.isError ? <p role="alert">The read-only diagnostic could not be retrieved. No repair was attempted. Verify Owner access and retry. {report.error.message.includes('timed out') ? 'The request timed out.' : ''}</p> : null}
        {report.data ? <>
          <p className="text-sm">Snapshot: {report.data.observedAt}. Remaining production: {report.data.canonicalPreview.remainingProductionQuantity}; remaining fulfillment: {report.data.canonicalPreview.remainingFulfillmentQuantity}; active jobs: {report.data.canonicalPreview.activeProductionJobCount}; lines needing ownership: {report.data.canonicalPreview.productionBootstrapLineCount}.</p>
          {report.data.findings.length ? <ul className="list-disc space-y-1 pl-5 text-sm">{report.data.findings.map((finding, index) => <li key={`${finding.code}-${index}`}>{finding.message}{finding.lineItemId ? ` Line: ${finding.lineItemId}` : ''}</li>)}</ul> : <p className="text-sm">No diagnostic flags identified. Review the canonical obligations and history in the full report.</p>}
          <Textarea aria-label="Order diagnostic report" readOnly value={text} className="min-h-48 max-h-[40dvh] resize-y font-mono text-xs" onFocus={event => event.currentTarget.select()}/>
        </> : null}
        {copyStatus ? <p role="status" className="text-sm">{copyStatus}</p> : null}
        <DialogFooter className="flex-wrap gap-2">
          <Button type="button" variant="outline" disabled={report.isFetching} onClick={() => { setCopyStatus(''); void report.refetch(); }}>Refresh report</Button>
          <Button type="button" disabled={!text || report.isFetching || report.isError} onClick={() => void copy()}>Copy diagnostic</Button>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
