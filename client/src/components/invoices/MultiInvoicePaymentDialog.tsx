import StripePayDialog from "@/components/payments/StripePayDialog";
import { useQueryClient } from "@tanstack/react-query";
import { staffPaymentMethodDefinitions } from "@shared/paymentMethodCatalog";
import { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { apiFetch } from '@/lib/queryClient';
import { useRecordCustomerInvoicePayment } from '@/hooks/useInvoices';
import { useActiveOrganizationRole } from '@/hooks/useActiveOrganizationRole';
import { useToast } from '@/hooks/use-toast';
import { parseTenderedAmountCents, reconcileCustomerPaymentEntry } from '@/lib/customerPaymentTender';
import type { CustomerPaymentAllocation, CustomerPaymentAllocationMode } from '@shared/customerPaymentAllocation';

type Preview = {
  customerId: string; customerName?: string | null; selectedCount: number; eligibleCount: number; excludedCount: number;
  totalOutstandingCents: number; message?: string | null;
  allocations: CustomerPaymentAllocation[];
  invoices: { invoiceId: string; invoiceNumber: string | number; invoiceDisplayNumber?: string | null; remainingCents: number; currency?: string; dueDate?: string | null; issueDate?: string | null }[];
};
type CardAvailability = {
  key: string;
  status: 'loading' | 'ready' | 'unavailable' | 'permission' | 'ineligible' | 'error';
  message: string;
};
const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const invoiceLabel = (invoice: Preview['invoices'][number]) => invoice.invoiceDisplayNumber || String(invoice.invoiceNumber);
const localPaymentDate = () => { const now = new Date(); return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16); };

export function MultiInvoicePaymentDialog({ open, onOpenChange, invoiceIds, onSuccess }: { open: boolean; onOpenChange(value: boolean): void; invoiceIds: string[]; onSuccess(): void }) {
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('check');
  const [paymentDate, setPaymentDate] = useState(localPaymentDate);
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [returnChangeKey, setReturnChangeKey] = useState<string | null>(null);
  const [cardAvailability, setCardAvailability] = useState<CardAvailability | null>(null);
  const { isAdminOrOwner } = useActiveOrganizationRole({ enabled: open });
  const [cardScope, setCardScope] = useState<{ ids: string[]; key: string; summaries: Array<{ invoiceNumber: string; amountDue: number; currency: string }> } | null>(null);
  const queryClient = useQueryClient();
  const isCard = method === 'credit_card';
  const [mode, setMode] = useState<CustomerPaymentAllocationMode>('oldest_first');
  const [previewState, setPreviewState] = useState<{ key: string; selectionKey: string; data: Preview } | null>(null);
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
  const displayPreview = previewState?.selectionKey === selectionKey ? previewState.data : null;
  const changeKey = JSON.stringify([selectionKey, displayPreview?.totalOutstandingCents, tenderedAmountCents, method, mode, custom]);
  const amounts = useMemo(() => reconcileCustomerPaymentEntry({ invoices: displayPreview?.invoices ?? [], tenderedAmountCents: tenderedAmountCents ?? 0,
    mode, customAmounts: custom, returnChange: returnChangeKey === changeKey }), [displayPreview, tenderedAmountCents, mode, custom, returnChangeKey, changeKey]);
  const validTenderedAmount = tenderedAmountCents != null && tenderedAmountCents > 0;
  const validPaymentDate = paymentDate !== '' && !Number.isNaN(new Date(paymentDate).getTime());

  useEffect(() => {
    if (open) { setCardScope(null); setCardAvailability(null); setMethod('check'); setMode('oldest_first'); setPreviewState(null); setCustom({}); setError(''); setAmount(''); setPaymentDate(localPaymentDate()); setReference(''); setNotes(''); setReturnChangeKey(null); submitting.current = false; request.current = null; }
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
      if (!response.ok) {
        const reason = body.code === 'ORDER_NOT_FOUND'
          ? `Invoice ${body.blockedInvoice?.invoiceNumber ?? '(selected)'} cannot be included because its linked Order could not be verified. Remove this invoice from the selection or resolve its billing relationship before taking payment.`
          : body.error || 'Unable to preview customer payment. Refresh the preview or correct the invoice selection.';
        throw new Error(reason);
      }
      setPreviewState({ key: previewKey, selectionKey, data: body.data });
    }).catch((error: Error) => { if (!cancelled) setError(error.message); });
    return () => { cancelled = true; };
  }, [open, previewKey]);

  const cardIdsKey = JSON.stringify(displayPreview?.invoices.map(invoice => invoice.invoiceId) || []);
  const cardAvailabilityKey = JSON.stringify([selectionKey, cardIdsKey, refresh]);
  const currentCardAvailability = cardAvailability?.key === cardAvailabilityKey ? cardAvailability : null;
  const cardAvailable = currentCardAvailability?.status === 'ready';
  useEffect(() => {
    let cancelled = false;
    const selectedIds = JSON.parse(cardIdsKey) as string[];
    if (!open || !selectedIds.length) return;
    const update = (status: CardAvailability['status'], message: string) => {
      if (!cancelled) setCardAvailability({ key: cardAvailabilityKey, status, message });
    };
    update('loading', 'Checking card payment availability…');
    void apiFetch('/api/invoices/customer-payment/stripe/runtime-config', {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ invoiceIds: selectedIds }),
    }).then(async response => {
      const body = await response.json();
      if (cancelled) return;
      if (response.status === 401 || response.status === 403) {
        update('permission', response.status === 401 ? 'Your session has expired. Sign in again to take payment.'
          : 'You do not have permission to process this payment.');
      } else if (!response.ok) {
        const message = typeof body?.error === 'string' ? body.error : '';
        if (response.status === 409 && (String(body?.code || '').startsWith('STRIPE_') || body?.code === 'PAYMENT_PROVIDER_NOT_SELECTED')) {
          update('unavailable', 'No configured card processor is currently available for this grouped payment.' + (message ? ' ' + message : ''));
        } else if ([400, 404, 409, 422].includes(response.status)) {
          update('ineligible', message || 'These invoices are not eligible for card payment. Refresh and review the selection.');
        } else {
          update('error', 'Unable to load payment configuration. Retry the availability check.');
        }
      } else {
        const config = body?.data;
        const validMode = config?.mode === 'test' || config?.mode === 'live';
        const prefix = config?.mode === 'test' ? 'pk_test_' : 'pk_live_';
        if (config?.provider === 'stripe' && config.readyForPayments === true && validMode
          && typeof config.publishableKey === 'string' && config.publishableKey.startsWith(prefix)
          && typeof config.connectedAccountId === 'string' && config.connectedAccountId.trim()) {
          update('ready', '');
        } else {
          update('error', 'Payment configuration returned an invalid response. Retry the availability check.');
        }
      }
    }).catch(() => update('error', 'Unable to load payment configuration. Check your connection and retry.'));
    return () => { cancelled = true; };
  }, [open, cardAvailabilityKey]);


  const submit = () => {
    if (isCard) {
      if (!preview || !cardAvailable || !preview.eligibleCount || cardScope) return;
      if (!window.confirm(`Confirm one card payment\nCustomer: ${preview.customerName || preview.customerId} (${preview.customerId})\nPayment: ${money(preview.totalOutstandingCents)}\nMethod: Credit Card\nDate and reference: assigned when Stripe confirms\n${preview.invoices.map(invoice => `Invoice ${invoiceLabel(invoice)}: ${money(invoice.remainingCents)}`).join('\n')}\nTotal applied: ${money(preview.totalOutstandingCents)}\nUnapplied credit: $0.00 · Change: $0.00\nContinue to secure card entry?`)) return;
      const signature = JSON.stringify(['stripe-full', preview.customerId, preview.invoices]);
      if (request.current?.signature !== signature) request.current = { signature, key: crypto.randomUUID() };
      setCardScope({ ids: preview.invoices.map(row => row.invoiceId), key: request.current.key,
        summaries: preview.invoices.map(row => ({ invoiceNumber: invoiceLabel(row), amountDue: row.remainingCents / 100, currency: row.currency || 'USD' })) });
      return;
    }
    if (submitting.current || mutation.isPending || !preview || !validTenderedAmount || !validPaymentDate || !amounts.ready) return;
    const customAllocations = mode === 'custom' ? amounts.customAllocations.map(row => ({ invoiceId: row.invoiceId, amountCents: row.amountCents! })) : undefined;
    const appliedAt = new Date(paymentDate).toISOString();
    const methodLabel = staffPaymentMethodDefinitions.find(item => item.id === method)?.label || method;
    if (!window.confirm(`Confirm customer payment\nCustomer: ${preview.customerName || preview.customerId} (${preview.customerId})\nPayment received: ${money(tenderedAmountCents!)}\nMethod: ${methodLabel}\nDate: ${new Date(appliedAt).toLocaleString()}\nReference: ${reference.trim() || 'Not provided'}\nNotes: ${notes.trim() || 'Not provided'}\nSelected invoice balances: ${money(preview.totalOutstandingCents)}\n${preview.invoices.map(invoice => `Invoice ${invoiceLabel(invoice)}: ${money(amounts.allocations.find(row => row.invoiceId === invoice.invoiceId)?.amountCents ?? 0)} applied (balance ${money(invoice.remainingCents)})`).join('\n')}\nTotal applied: ${money(amounts.appliedAmountCents)}\nRemaining invoice balance: ${money(amounts.remainingBalanceCents)}\nReturned change: ${money(amounts.changeDueCents)}\nUnapplied customer credit: $0.00\nNo account credit will be created. Record this payment?`)) return;
    // Reuse the key on an uncertain retry of this same payment intent.
    const signature = JSON.stringify([selectionKey, tenderedAmountCents, method, mode, customAllocations, appliedAt, reference.trim(), notes.trim(), amounts.allocations]);
    if (request.current?.signature !== signature) request.current = { signature, key: crypto.randomUUID() };
    submitting.current = true;
    mutation.mutate({ invoiceIds, amountCents: tenderedAmountCents!, allocationMode: mode, customAllocations, method,
      appliedAt, reference: reference.trim() || undefined, notes: notes.trim() || undefined, expectedAllocations: amounts.allocations,
      idempotencyKey: request.current.key, expectedCustomerId: preview.customerId,
      expectedRemainingCents: Object.fromEntries(preview.invoices.map(x => [x.invoiceId, x.remainingCents])),
    }, {
      onSuccess: response => {
        const result = response.data;
        toast({ title: 'Customer payment recorded', description: `${money(result.appliedAmountCents)} applied. Change due: ${money(result.changeDueCents)}. No account credit created.` });
        onSuccess(); onOpenChange(false);
      },
      onError: (error: Error) => { submitting.current = false; setError(error.message); },
    });
  };

  return <><Dialog open={open && !cardScope} onOpenChange={value => { if (!mutation.isPending) onOpenChange(value); }}>
    <DialogContent className="max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>Add Customer Payment</DialogTitle>
      <DialogDescription>{invoiceIds.length} invoices selected. Only eligible open balances receive payment. All selected invoices must belong to the same customer.</DialogDescription>
    </DialogHeader>
      <div className="grid gap-3">
        <div className="rounded-md border border-border bg-muted/30 p-3" aria-live="polite">
          {displayPreview ? <>
            <p className="font-medium">Customer: {displayPreview.customerName || displayPreview.customerId}</p>
            <p>{displayPreview.eligibleCount} payable invoices · {displayPreview.excludedCount} paid/non-payable invoices excluded</p>
            <p className="text-sm text-muted-foreground">Selected invoice balances</p>
            <p className="text-2xl font-semibold">{money(displayPreview.totalOutstandingCents)}</p>
            {displayPreview.message && <p role="status">{displayPreview.message}</p>}
            {!preview && !error && <p className="text-sm" role="status">Checking current balances before posting…</p>}
          </> : <p>{error ? 'Review the selected invoices before taking payment.' : invoiceIds.length ? 'Loading…' : 'Select at least one invoice.'}</p>}
        </div>
        {!isCard && <div><Label htmlFor="customer-payment-amount">Payment received</Label><Input id="customer-payment-amount" disabled={mutation.isPending} inputMode="decimal" type="text" placeholder="0.00" value={amount} onChange={event => setAmount(event.target.value)} /></div>}
        {!isCard && displayPreview && validTenderedAmount && <div aria-label="Payment reconciliation" aria-live="polite" className="grid gap-1 rounded-md border border-border px-3 py-2 text-sm">
          <p>Payment received: <strong>{money(tenderedAmountCents!)}</strong></p>
          <p>Applied to invoices: <strong>{money(amounts.appliedAmountCents)}</strong></p>
          <p>Change due: <strong>{money(amounts.changeDueCents)}</strong></p>
          <p>Unresolved funds: <strong>{money(amounts.unresolvedCents)}</strong></p>
          <p>Unapplied customer credit from this payment: <strong>{money(amounts.unappliedCreditCents)}</strong></p>
          <p>Remaining invoice balance: <strong>{money(amounts.remainingBalanceCents)}</strong></p>
          {amounts.error && <p role="alert" className="text-destructive">{amounts.error}</p>}
          {amounts.potentialChangeCents > 0 && <div className="mt-1 space-y-1 border-t border-border pt-2">
            <p>Excess received: {money(amounts.potentialChangeCents)}. This payment flow cannot retain excess funds as account credit.</p>
            <label className="flex items-start gap-2"><input type="checkbox" className="mt-0.5 accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" disabled={mutation.isPending} checked={returnChangeKey === changeKey} onChange={event => setReturnChangeKey(event.target.checked ? changeKey : null)} />I will return {money(amounts.potentialChangeCents)} as change; do not create account credit.</label>
            <p className="text-muted-foreground">To hold funds on account, cancel and use the existing Customer Advance workflow.</p>
          </div>}
        </div>}
        {!isCard && amount.trim() && !validTenderedAmount && <p role="alert" className="text-sm text-destructive">Enter a positive payment amount with at most two decimal places.</p>}
        <div><Label>Payment method</Label><Select disabled={mutation.isPending} value={method} onValueChange={setMethod}><SelectTrigger aria-label="Payment method"><SelectValue /></SelectTrigger><SelectContent>{staffPaymentMethodDefinitions.map(method => <SelectItem key={method.id} value={method.id}>{method.label}</SelectItem>)}</SelectContent></Select></div>
        {!isCard && <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><div><Label htmlFor="customer-payment-date">Payment date/time</Label><Input id="customer-payment-date" type="datetime-local" className="[color-scheme:light] dark:[color-scheme:dark]" disabled={mutation.isPending} value={paymentDate} onChange={event => setPaymentDate(event.target.value)} /></div><div><Label htmlFor="customer-payment-reference">Payment reference</Label><Input id="customer-payment-reference" maxLength={255} disabled={mutation.isPending} value={reference} onChange={event => setReference(event.target.value)} /></div></div>
          {!validPaymentDate && <p role="alert" className="text-sm text-destructive">Enter a valid payment date and time.</p>}
          <div><Label htmlFor="customer-payment-notes">Notes / payment source (optional)</Label><Input id="customer-payment-notes" maxLength={5000} disabled={mutation.isPending} value={notes} onChange={event => setNotes(event.target.value)} /></div>
        </>}
        {!isCard && <div><Label>Allocation</Label><Select disabled={mutation.isPending} value={mode} onValueChange={(value: CustomerPaymentAllocationMode) => {
          if (value === 'custom' && !Object.keys(custom).length && displayPreview && validTenderedAmount) setCustom(Object.fromEntries(displayPreview.invoices.map(invoice => [invoice.invoiceId, ((amounts.allocations.find(row => row.invoiceId === invoice.invoiceId)?.amountCents ?? 0) / 100).toFixed(2)])));
          setMode(value);
        }}><SelectTrigger aria-label="Allocation"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="oldest_first">Oldest invoice first</SelectItem><SelectItem value="proportional">Proportional</SelectItem><SelectItem value="custom">Custom allocation</SelectItem></SelectContent></Select></div>}
        {!isCard && displayPreview && mode !== 'custom' && validTenderedAmount && amounts.allocations.length > 0 && <div className="grid gap-1" aria-label="Allocation preview">
          <p className="font-medium">Allocation preview</p>
          {amounts.allocations.map(allocation => <p key={allocation.invoiceId}>Invoice {(() => { const invoice = displayPreview.invoices.find(x => x.invoiceId === allocation.invoiceId); return invoice ? invoiceLabel(invoice) : allocation.invoiceId; })()}: {money(allocation.amountCents)}</p>)}
        </div>}
        {!isCard && mode === 'custom' && displayPreview && <div className="grid gap-2" aria-label="Custom allocations">{displayPreview.invoices.map(invoice => <div className="flex items-center gap-2" key={invoice.invoiceId}><span className="flex-1 text-sm">Invoice {invoiceLabel(invoice)} · Balance {money(invoice.remainingCents)}</span><Input disabled={mutation.isPending} className="w-28" type="text" inputMode="decimal" placeholder="0.00" aria-label={`Allocation for invoice ${invoiceLabel(invoice)}`} value={custom[invoice.invoiceId] || ''} onChange={event => setCustom(old => ({ ...old, [invoice.invoiceId]: event.target.value }))} /></div>)}</div>}
        {isCard && preview && <div className="space-y-1 rounded-md border p-3" aria-label="Card allocation preview">
          <p className="font-medium">Full invoice balances · {money(preview.totalOutstandingCents)} total</p>
          {preview.invoices.map(row => <p key={row.invoiceId}>Invoice {invoiceLabel(row)}: {money(row.remainingCents)}</p>)}
          <p className="text-sm text-muted-foreground">One Stripe transaction. Payment is complete after saved allocations are confirmed.</p>
        </div>}
        {isCard && !cardAvailable && !error && <div className="space-y-2 rounded-md border p-3" role="status" aria-live="polite">
          <p>{!preview ? 'Checking invoice eligibility…' : !preview.eligibleCount
            ? 'No selected invoices have eligible open balances for card payment.'
            : currentCardAvailability?.message || 'Checking card payment availability…'}</p>
          {currentCardAvailability?.status === 'unavailable' && isAdminOrOwner && <Button type="button" size="sm" variant="outline" asChild>
            <a href="/settings/integrations">Open Payment Settings</a>
          </Button>}
          {currentCardAvailability && ['error', 'ineligible', 'unavailable'].includes(currentCardAvailability.status) && <Button type="button" variant="link"
            onClick={() => setRefresh(value => value + 1)}>Retry availability check</Button>}
        </div>}
        {error && <div role="alert" className="text-sm text-destructive">{error}<Button type="button" variant="link" disabled={mutation.isPending} onClick={() => setRefresh(value => value + 1)}>Refresh preview</Button><Button type="button" variant="link" disabled={mutation.isPending} onClick={() => onOpenChange(false)}>Change selection</Button></div>}
        <div className="flex justify-end gap-2"><Button disabled={mutation.isPending} variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button disabled={mutation.isPending || !preview || (isCard ? !cardAvailable || !preview.eligibleCount : !validTenderedAmount || !validPaymentDate || !amounts.ready)} onClick={submit}>{mutation.isPending ? 'Recording…' : isCard ? 'Continue to Card Payment' : 'Record Payment'}</Button></div>
      </div>
    </DialogContent>
  </Dialog>
  {open && cardScope && <StripePayDialog open invoiceId={cardScope.ids[0]} invoiceIds={cardScope.ids} invoiceSummaries={cardScope.summaries}
    apiBasePath="/api/invoices" groupedInitiation groupedApiBasePath="/api/invoices/customer-payment/stripe" checkoutKey={cardScope.key}
    onOpenChange={value => { if (!value) setCardScope(null); }}
    onRecovery={() => { request.current = null; setRefresh(value => value + 1); }}
    onSettled={async ({ paymentIntentId }) => {
      const response = await apiFetch('/api/invoices/customer-payment/stripe/status', { method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paymentIntentId }) });
      const body = await response.json();
      if (!response.ok || body?.data?.finalized !== true) return { reconciled: false };
      await queryClient.invalidateQueries({ queryKey: ['invoices'] });
      for (const id of cardScope.ids) {
        await queryClient.invalidateQueries({ queryKey: ['invoices', id] });
        await queryClient.invalidateQueries({ queryKey: ['invoicePayments', id] });
      }
      toast({ title: 'Card payment recorded', description: `${body.data.allocations.length} invoice allocations confirmed.` });
      request.current = null; onSuccess(); onOpenChange(false);
      return { reconciled: true };
    }} />}
  </>;
}
