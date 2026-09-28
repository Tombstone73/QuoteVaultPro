import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BILLING_OWNERSHIP_REVIEW_MESSAGE, type BillingOwnershipReview } from '@shared/billingOwnershipReview';
import { apiFetch } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';

export function useBillingOwnershipReview(resource: 'orders' | 'invoices', id?: string) {
  return useQuery<{ hold: BillingOwnershipReview | null }>({
    queryKey: ['billing-ownership-review', resource, id], enabled: Boolean(id),
    queryFn: async () => {
      const response = await apiFetch(`/api/${resource}/${id}/billing-ownership-review`);
      if (!response.ok) throw new Error('Unable to load billing ownership review.');
      return response.json();
    },
  });
}

export function BillingOwnershipReviewPanel({ hold, canResolve }: { hold: BillingOwnershipReview | null | undefined; canResolve: boolean }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  if (!hold) return null;
  const acknowledge = async () => {
    setPending(true); setError('');
    try {
      const response = await apiFetch(`/api/invoices/${hold.invoiceId}/billing-ownership-review/resolve`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ overrideId: hold.id, reason: reason.trim(), confirmed: true }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Unable to acknowledge reconciliation.');
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['billing-ownership-review'] }), queryClient.invalidateQueries({ queryKey: ['invoices'] })]);
      setOpen(false); setReason('');
    } catch (error: any) { setError(error.message); } finally { setPending(false); }
  };
  return <div role="status" className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 space-y-2 text-sm">
    <p className="font-semibold">QuickBooks Update Required</p>
    <p>{BILLING_OWNERSHIP_REVIEW_MESSAGE} Automatic and manual QuickBooks sync are held.</p>
    <p className="text-muted-foreground">Override reason: {hold.reason}</p>
    {canResolve && <Button type="button" variant="outline" onClick={() => setOpen(true)}>Acknowledge QuickBooks correction</Button>}
    <Dialog open={open} onOpenChange={next => { if (!pending) setOpen(next); }}>
      <DialogContent><DialogHeader><DialogTitle>QuickBooks manually corrected?</DialogTitle>
        <DialogDescription>Confirm accounting has corrected the billing party in QuickBooks. This clears the ownership hold only. Accounting reapproval and normal sync rules still apply; nothing is sent now.</DialogDescription></DialogHeader>
        <Textarea aria-label="Reconciliation note" value={reason} maxLength={2000} onChange={event => setReason(event.target.value)} disabled={pending} />
        {error && <p role="alert">{error}</p>}
        <DialogFooter><Button type="button" variant="outline" disabled={pending} onClick={() => setOpen(false)}>Cancel</Button>
          <Button type="button" disabled={pending || !reason.trim()} onClick={() => void acknowledge()}>Confirm QuickBooks was corrected</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}
