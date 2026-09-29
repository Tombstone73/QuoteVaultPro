import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { OrderCreditHold } from '@shared/orderCreditHold';
import { apiRequest } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const money = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);

export function OrderCreditHoldBanner({ orderId, hold, canOverride }: { orderId: string; hold?: OrderCreditHold; canOverride: boolean }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const queryClient = useQueryClient();
  const override = useMutation({
    mutationFn: () => apiRequest('POST', `/api/orders/${orderId}/credit-override`, { confirmed: true, reason }),
    onSuccess: async () => {
      setOpen(false);
      setReason('');
      await queryClient.invalidateQueries({ predicate: query => query.queryKey.some(key => typeof key === 'string' && (key === 'orders' || key.startsWith('/api/orders'))) });
    },
  });
  if (!hold?.held) return hold?.overrideApplied ? <p className="my-3 text-sm text-muted-foreground">Production credit override applies to the reviewed Order value and customer financial position. Changes require a fresh review.</p> : null;
  return <>
    <div role="status" className="my-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-4 text-sm space-y-2">
      <p className="font-semibold">Awaiting Payment — Payment Required Before Production</p>
      <p>Order entry, artwork and proofing may continue. Payment or an authorized credit override is required before physical production.</p>
      <div className="flex flex-wrap gap-x-5 gap-y-1">
        {hold.creditLimitCents !== null && <span>Customer credit limit: {money(hold.creditLimitCents)}</span>}
        <span>Current exposure: {money(hold.exposureCents)}</span>
        <span>Amount required to release: {money(hold.requiredPaymentCents)}</span>
      </div>
      <p>Applied payments automatically recompute the hold. Use the linked Invoice and existing accounting approval/payment flow to collect payment.</p>
      {canOverride && <Button type="button" variant="outline" onClick={() => { override.reset(); setOpen(true); }}>Override Credit Hold</Button>}
    </div>
    <Dialog open={open} onOpenChange={next => { if (!override.isPending) setOpen(next); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Override Credit Hold</DialogTitle><DialogDescription>Authorize physical production despite the current credit shortfall. Your identity, timestamp, reason and financial position will be recorded. A changed Order value, billing customer, credit limit or exposure requires a fresh review.</DialogDescription></DialogHeader>
        <label htmlFor="credit-override-reason">Reason</label>
        <Textarea id="credit-override-reason" value={reason} onChange={event => setReason(event.target.value)} maxLength={2000} disabled={override.isPending} />
        {override.error && <p role="alert" className="text-sm text-destructive">{override.error.message}</p>}
        <DialogFooter><Button type="button" variant="outline" disabled={override.isPending} onClick={() => setOpen(false)}>Cancel</Button><Button type="button" disabled={override.isPending || !reason.trim()} onClick={() => override.mutate()}>Confirm Credit Override</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
