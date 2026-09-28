import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { apiFetch } from '@/lib/queryClient';
import { useRecordCustomerInvoicePayment } from '@/hooks/useInvoices';
import { useToast } from '@/hooks/use-toast';
import { parseTenderedAmountCents, resolveCustomerPaymentAmounts } from '@/lib/customerPaymentTender';
import type { CustomerPaymentAllocation, CustomerPaymentAllocationMode } from '@shared/customerPaymentAllocation';

type Preview = {
  customerId: string; selectedCount: number; eligibleCount: number; excludedCount: number;
  totalOutstandingCents: number; message?: string | null;
  allocations: CustomerPaymentAllocation[];
  invoices: { invoiceId: string; invoiceNumber: string | number; remainingCents: number }[];
};
const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export function MultiInvoicePaymentDialog({ open, onOpenChange, invoiceIds, onSuccess }: { open: boolean; onOpenChange(value: boolean): void; invoiceIds: string[]; onSuccess(): void }) {
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('check');
  const [mode, setMode] = useState<CustomerPaymentAllocationMode>('oldest_first');
  const [previewState, setPreviewState] = useState<{ key: string; data: Preview } | null>(null);
  const [custom, setCustom] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const submitting = useRef(false);
  const request = useRef<{ signature: string; key: string } | null>(null);
  const { toast } = useToast();
  const mutation = useRecordCustomerInvoicePayment();
  const tenderedAmountCents = parseTenderedAmountCents(amount);
  const previewAmountCents = Math.max(1, tenderedAmountCents ?? 1);
  const selectionKey = JSON.stringify(invoiceIds);
  const previewKey = JSON.stringify([selectionKey, previewAmountCents, mode, refresh]);
  const preview = previewState?.key === previewKey ? previewState.data : null;
  const amounts = resolveCustomerPaymentAmounts(preview?.totalOutstandingCents ?? 0, tenderedAmountCents ?? 0);
  const validTenderedAmount = tenderedAmountCents != null && tenderedAmountCents > 0;

  useEffect(() => {
    if (open) { setPreviewState(null); setCustom({}); setError(''); setAmount(''); submitting.current = false; request.current = null; }
  }, [open, selectionKey]);
  useEffect(() => {
    if (!open || !invoiceIds.length) return;
    let cancelled = false;
    setError('');
    void apiFetch('/api/invoices/customer-payment/preview', {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ invoiceIds, amountCents: previewAmountCents, allocationMode: mode === 'custom' ? 'oldest_first' : mode }),
    }).then(async response => {
      const body = await response.json().catch(() => ({}));
      if (cancelled) return;
      if (!response.ok) throw new Error(body.error || 'Unable to preview customer payment.');
      setPreviewState({ key: previewKey, data: body.data });
    }).catch((error: Error) => { if (!cancelled) setError(error.message); });
    return () => { cancelled = true; };
  }, [open, previewKey]);

  const submit = () => {
    if (submitting.current || mutation.isPending || !preview || !validTenderedAmount || amounts.appliedAmountCents <= 0) return;
    const customAllocations = mode === 'custom' ? preview.invoices.map(x => ({ invoiceId: x.invoiceId, amountCents: parseTenderedAmountCents(custom[x.invoiceId] || '') ?? 0 })) : undefined;
    const changeMessage = amounts.changeDueCents ? ` Change due: ${money(amounts.changeDueCents)}.` : '';
    if (!window.confirm(`Record one ${method} payment of ${money(amounts.appliedAmountCents)} across eligible open invoices?${changeMessage}`)) return;
    // Reuse the key on an uncertain retry of this same payment intent.
    const signature = JSON.stringify([selectionKey, tenderedAmountCents, method, mode, customAllocations]);
    if (request.current?.signature !== signature) request.current = { signature, key: crypto.randomUUID() };
    submitting.current = true;
    mutation.mutate({ invoiceIds, amountCents: tenderedAmountCents!, allocationMode: mode, customAllocations, method,
      idempotencyKey: request.current.key, expectedCustomerId: preview.customerId,
      expectedRemainingCents: Object.fromEntries(preview.invoices.map(x => [x.invoiceId, x.remainingCents])),
    }, {
      onSuccess: response => {
        const result = response.data;
        toast({ title: 'Customer payment recorded', description: `${money(result.appliedAmountCents)} applied. Change / unapplied: ${money(result.changeDueCents)}.` });
        onSuccess(); onOpenChange(false);
      },
      onError: (error: Error) => { submitting.current = false; setError(error.message); },
    });
  };

  return <Dialog open={open} onOpenChange={value => { if (!mutation.isPending) onOpenChange(value); }}>
    <DialogContent className="max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>Add Customer Payment</DialogTitle>
      <DialogDescription>{invoiceIds.length} invoices selected. Only eligible open balances receive payment. All selected invoices must belong to the same customer.</DialogDescription>
    </DialogHeader>
      <div className="grid gap-3">
        <div className="rounded-md border border-border bg-muted/30 p-3" aria-live="polite">
          {preview ? <>
            <p>{preview.eligibleCount} payable invoices · {preview.excludedCount} paid/non-payable invoices excluded</p>
            <p className="text-sm text-muted-foreground">Eligible balance</p>
            <p className="text-2xl font-semibold">{money(preview.totalOutstandingCents)}</p>
            {preview.message && <p role="status">{preview.message}</p>}
          </> : <p>{error ? 'Preview unavailable.' : invoiceIds.length ? 'Loading…' : 'Select at least one invoice.'}</p>}
        </div>
        <div><Label htmlFor="customer-payment-amount">Amount tendered</Label><Input id="customer-payment-amount" disabled={mutation.isPending} inputMode="decimal" type="text" placeholder="0.00" value={amount} onChange={event => setAmount(event.target.value)} /></div>
        {preview && validTenderedAmount && <div className="grid gap-2 rounded-md border border-border px-3 py-2">
          <p>Applied payment: <strong>{money(amounts.appliedAmountCents)}</strong></p>
          <p>Change due / unapplied: <strong>{money(amounts.changeDueCents)}</strong></p>
          <p>Remaining balance: <strong>{money(amounts.remainingBalanceCents)}</strong></p>
        </div>}
        <div><Label>Payment method</Label><Select disabled={mutation.isPending} value={method} onValueChange={setMethod}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{['cash','check','wire','bank_transfer','ach','other'].map(x => <SelectItem key={x} value={x}>{x.replace('_', ' ')}</SelectItem>)}</SelectContent></Select></div>
        <div><Label>Allocation</Label><Select disabled={mutation.isPending} value={mode} onValueChange={(value: CustomerPaymentAllocationMode) => setMode(value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="oldest_first">Oldest invoice first</SelectItem><SelectItem value="proportional">Proportional</SelectItem><SelectItem value="custom">Custom allocation</SelectItem></SelectContent></Select></div>
        {preview && mode !== 'custom' && validTenderedAmount && preview.allocations.length > 0 && <div className="grid gap-1" aria-label="Allocation preview">
          <p className="font-medium">Allocation preview</p>
          {preview.allocations.map(allocation => <p key={allocation.invoiceId}>Invoice {preview.invoices.find(x => x.invoiceId === allocation.invoiceId)?.invoiceNumber}: {money(allocation.amountCents)}</p>)}
        </div>}
        {mode === 'custom' && preview && <div className="grid gap-2">{preview.invoices.map(invoice => <div className="flex items-center gap-2" key={invoice.invoiceId}><span className="flex-1 text-sm">Invoice {invoice.invoiceNumber}</span><Input disabled={mutation.isPending} className="w-28" type="text" inputMode="decimal" placeholder="0.00" aria-label={`Allocation for invoice ${invoice.invoiceNumber}`} value={custom[invoice.invoiceId] || ''} onChange={event => setCustom(old => ({ ...old, [invoice.invoiceId]: event.target.value }))} /></div>)}</div>}
        {error && <div role="alert" className="text-sm text-destructive">{error}<Button type="button" variant="link" disabled={mutation.isPending} onClick={() => { setCustom({}); setRefresh(value => value + 1); }}>Refresh preview</Button></div>}
        <div className="flex justify-end gap-2"><Button disabled={mutation.isPending} variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button disabled={mutation.isPending || !preview || !validTenderedAmount || amounts.appliedAmountCents <= 0} onClick={submit}>{mutation.isPending ? 'Recording…' : 'Record Payment'}</Button></div>
      </div>
    </DialogContent>
  </Dialog>;
}
