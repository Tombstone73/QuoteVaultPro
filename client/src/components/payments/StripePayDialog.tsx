import { useEffect, useMemo, useState } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';

function StripePayInner(props: {
  clientSecret: string;
  onClose: () => void;
  onSettled: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const { toast } = useToast();
  const [submitting, setSubmitting] = useState(false);

  const handleConfirm = async () => {
    if (!stripe || !elements) return;
    setSubmitting(true);
    try {
      const result = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: window.location.href,
        },
        redirect: 'if_required',
      });

      if (result.error) {
        toast({
          title: 'Payment failed',
          description: result.error.message || 'Please try again.',
          variant: 'destructive',
        });
        return;
      }

      toast({
        title: 'Payment submitted',
        description: 'We’ll update the invoice once Stripe confirms the payment.',
      });

      props.onClose();
      props.onSettled();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div className="space-y-4">
        <PaymentElement />
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={props.onClose} disabled={submitting}>
          Close
        </Button>
        <Button onClick={handleConfirm} disabled={!stripe || !elements || submitting}>
          {submitting ? 'Processing…' : 'Pay'}
        </Button>
      </DialogFooter>
    </>
  );
}

export default function StripePayDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoiceId: string;
  disabled?: boolean;
  onSettled: () => void;
}) {
  const publishableKey = (import.meta as any).env?.VITE_STRIPE_PUBLISHABLE_KEY as string | undefined;

  const stripePromise = useMemo(() => {
    if (!publishableKey) return null;
    return loadStripe(publishableKey);
  }, [publishableKey]);

  const { toast } = useToast();
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [loadingIntent, setLoadingIntent] = useState(false);

  useEffect(() => {
    if (!props.open) {
      setClientSecret(null);
      setLoadingIntent(false);
      return;
    }

    if (clientSecret) return;
    if (!props.invoiceId) return;

    const run = async () => {
      setLoadingIntent(true);
      try {
        const res = await fetch(`/api/invoices/${props.invoiceId}/payments/stripe/create-intent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error((json as any)?.error || 'Failed to create payment intent');

        const secret = (json as any)?.data?.clientSecret as string | undefined;
        if (!secret) throw new Error('Missing clientSecret');
        setClientSecret(secret);
      } catch (e: any) {
        toast({
          title: 'Unable to start payment',
          description: e?.message || 'Please try again.',
          variant: 'destructive',
        });
        props.onOpenChange(false);
      } finally {
        setLoadingIntent(false);
      }
    };

    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.open, props.invoiceId]);

  const close = () => props.onOpenChange(false);

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Pay Invoice</DialogTitle>
        </DialogHeader>

        {!publishableKey && (
          <div className="text-sm text-muted-foreground">
            Stripe is not configured (missing <span className="font-mono">VITE_STRIPE_PUBLISHABLE_KEY</span>).
          </div>
        )}

        {publishableKey && (!stripePromise || loadingIntent) && (
          <div className="text-sm text-muted-foreground">Preparing secure payment…</div>
        )}

        {publishableKey && stripePromise && clientSecret && (
          <Elements stripe={stripePromise} options={{ clientSecret }}>
            <StripePayInner clientSecret={clientSecret} onClose={close} onSettled={props.onSettled} />
          </Elements>
        )}

        {publishableKey && stripePromise && !loadingIntent && !clientSecret && (
          <DialogFooter>
            <Button variant="outline" onClick={close}>
              Close
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
