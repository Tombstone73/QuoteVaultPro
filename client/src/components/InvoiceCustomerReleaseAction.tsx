import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { MoreHorizontal } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel } from '@/components/ui/alert-dialog';
import { apiFetch } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';

export type InvoiceCustomerReleaseState = {
  id: string;
  customerVisible?: boolean;
  customerReleaseEligible?: boolean;
  customerReleasedAt?: Date | string | null;
};

/** Shared list/detail control; customer visibility is projected by the server. */
export function InvoiceCustomerReleaseAction({ invoice, canRelease, compact = false }: {
  invoice: InvoiceCustomerReleaseState; canRelease: boolean; compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const release = useMutation({
    mutationFn: async () => {
      const response = await apiFetch(`/api/invoices/${invoice.id}/release-to-customer`, { method: 'POST', credentials: 'include' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Unable to release invoice.');
      return payload;
    },
    onSuccess: () => {
      setOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['invoices'] });
      void queryClient.invalidateQueries({ queryKey: ['portal'] });
      toast({ title: 'Released to Customer', description: 'No email was sent. Accounting approval is unchanged.' });
    },
    onError: (error: Error) => toast({ title: 'Release failed', description: error.message, variant: 'destructive' }),
  });
  return <div className="flex flex-wrap items-center gap-1" onClick={(event) => event.stopPropagation()}>
    <Badge variant="outline">{invoice.customerReleasedAt ? 'Customer Released' : invoice.customerVisible ? 'Customer Visible' : 'Internal Only'}</Badge>
    {canRelease && invoice.customerReleaseEligible && (compact ? <DropdownMenu>
      <DropdownMenuTrigger asChild><Button type="button" size="icon" variant="outline" className="h-8 w-8" aria-label="Customer access actions"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end"><DropdownMenuItem onSelect={() => setOpen(true)}>Release to Customer</DropdownMenuItem></DropdownMenuContent>
    </DropdownMenu> : <Button type="button" size="sm" variant="outline" className="h-8 px-2 text-xs" onClick={() => setOpen(true)}>Release to Customer</Button>)}
    <AlertDialog open={open} onOpenChange={(value) => { if (!release.isPending) setOpen(value); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Release invoice to customer?</AlertDialogTitle>
          <AlertDialogDescription>This makes the invoice visible to its customer and allows payment of its eligible remaining balance. It does not approve accounting, queue QuickBooks sync, or send email. There is no undo action for customer release.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={release.isPending}>Cancel</AlertDialogCancel>
          <Button type="button" disabled={release.isPending} onClick={() => release.mutate()}>{release.isPending ? 'Releasing…' : 'Release to Customer'}</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>;
}
