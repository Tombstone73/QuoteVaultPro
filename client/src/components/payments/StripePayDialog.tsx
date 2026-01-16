import { useEffect, useMemo, useRef, useState } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';

const STRIPE_PAY_DEBUG = Boolean((import.meta as any).env?.DEV);

function StripePayInner(props: {
  clientSecret: string;
  onClose: () => void;
  onSettled: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const { toast } = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [paymentElementReady, setPaymentElementReady] = useState(false);

  const confirmAttemptRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    // Only track component mount/unmount here.
    // Do NOT tie this to clientSecret changes, otherwise state cleanup logic breaks.
    // If the clientSecret changes (new intent), the PaymentElement will remount.
    // We must wait for onReady again before allowing confirmPayment.
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    // If the clientSecret changes (new intent), the PaymentElement will remount.
    // We must wait for onReady again before allowing confirmPayment.
    setPaymentElementReady(false);
    if (STRIPE_PAY_DEBUG) {
      console.debug('[StripePayDialog] clientSecret set (inner)', `${props.clientSecret.slice(0, 12)}…`);
    }
  }, [props.clientSecret]);

  useEffect(() => {
    if (!STRIPE_PAY_DEBUG) return;
    const hasStripe = Boolean(stripe);
    const hasElements = Boolean(elements);
    const hasPaymentEl = Boolean(elements?.getElement(PaymentElement));
    console.debug('[StripePayDialog] readiness', {
      hasStripe,
      hasElements,
      paymentElementReady,
      hasPaymentEl,
    });
  }, [stripe, elements, paymentElementReady]);

  const schedulePostSubmitRefresh = () => {
    // 3–5 attempts over ~10–15s to catch fast webhooks without lying if delayed.
    const delaysMs = [0, 1500, 3500, 7000, 12000];
    delaysMs.forEach((delay) => {
      window.setTimeout(() => {
        try {
          props.onSettled();
        } catch {
          // no-op
        }
      }, delay);
    });
  };

  const handleConfirm = async () => {
    confirmAttemptRef.current += 1;
    const attempt = confirmAttemptRef.current;
    if (STRIPE_PAY_DEBUG) console.debug('[StripePayDialog] Pay clicked', { attempt });

    // Guard: confirmPayment requires a mounted PaymentElement.
    // Calling it before Stripe + Elements are ready (or before PaymentElement mounts) throws a runtime error.
    if (!stripe || !elements || !props.clientSecret) return;
    const paymentElement = elements.getElement(PaymentElement);
    if (!paymentElementReady || !paymentElement) {
      if (STRIPE_PAY_DEBUG) {
        console.debug('[StripePayDialog] confirm blocked (PaymentElement not mounted)', {
          paymentElementReady,
          hasPaymentEl: Boolean(paymentElement),
        });
      }
      toast({
        title: 'Payment form is still loading',
        description: 'Please wait for the card fields to load, then try again.',
        variant: 'destructive',
      });
      return;
    }

    if (STRIPE_PAY_DEBUG) {
      console.debug('[StripePayDialog] confirmPayment called', {
        attempt,
        hasStripe: Boolean(stripe),
        hasElements: Boolean(elements),
        hasPaymentEl: Boolean(paymentElement),
      });
    }
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

      schedulePostSubmitRefresh();
      props.onClose();
    } finally {
      if (mountedRef.current) setSubmitting(false);
    }
  };

  return (
    <>
      <div className="space-y-4">
        {/* Guard rendering with clientSecret in parent; onReady confirms the PaymentElement is mounted. */}
        <PaymentElement
          onReady={() => {
            if (STRIPE_PAY_DEBUG) console.debug('[StripePayDialog] PaymentElement mounted');
            setPaymentElementReady(true);
          }}
        />
        {!paymentElementReady ? (
          <div className="text-sm text-muted-foreground">Loading payment form…</div>
        ) : null}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={props.onClose} disabled={submitting}>
          Close
        </Button>
        <Button
          onClick={handleConfirm}
          disabled={!stripe || !elements || !props.clientSecret || !paymentElementReady || submitting}
        >
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
  const [loadingIntent, setLoadingIntent] = useState(false);
  const [intentError, setIntentError] = useState<string | null>(null);

  // Freeze clientSecret/options for the lifetime of an open dialog.
  // This prevents <Elements> from being unmounted/remounted due to state changes.
  const clientSecretRef = useRef<string | null>(null);
  const elementsOptionsRef = useRef<{ clientSecret: string } | null>(null);
  const intentRequestedRef = useRef(false);
  const [hasClientSecret, setHasClientSecret] = useState(false);

  const frozenClientSecret = clientSecretRef.current;
  const frozenElementsOptions = elementsOptionsRef.current;

  useEffect(() => {
    if (!props.open) {
      setLoadingIntent(false);
      setIntentError(null);

      // Reset ONLY when dialog closes so re-opening starts a fresh payment flow.
      clientSecretRef.current = null;
      elementsOptionsRef.current = null;
      intentRequestedRef.current = false;
      setHasClientSecret(false);
      return;
    }

    if (!props.invoiceId) return;
    if (hasClientSecret || clientSecretRef.current) return;
    if (intentRequestedRef.current) return;

    intentRequestedRef.current = true;
    if (STRIPE_PAY_DEBUG) {
      console.debug('[StripePayDialog] create-intent requested', { invoiceId: props.invoiceId });
    }

    const run = async () => {
      setLoadingIntent(true);
      setIntentError(null);
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
        if (STRIPE_PAY_DEBUG) {
          console.debug('[StripePayDialog] clientSecret set (outer)', `${secret.slice(0, 12)}…`);
        }

        // Freeze the secret + options ONCE; never overwrite while the dialog is open.
        if (!clientSecretRef.current) {
          clientSecretRef.current = secret;
          elementsOptionsRef.current = { clientSecret: secret };
          setHasClientSecret(true);
        }
      } catch (e: any) {
        const message = e?.message || 'Please try again.';
        toast({
          title: 'Unable to start payment',
          description: message,
          variant: 'destructive',
        });
        // Keep the dialog open during initial mount so it doesn't flash/close while the PaymentElement is initializing.
        setIntentError(message);
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

        {/* Show loading ONLY until we have a frozen clientSecret and Stripe.js is ready. */}
        {publishableKey && (!stripePromise || loadingIntent || !hasClientSecret) ? (
          <div className="text-sm text-muted-foreground">Loading payment form…</div>
        ) : null}

        {publishableKey && stripePromise && !loadingIntent && !hasClientSecret && intentError && (
          <div className="text-sm text-muted-foreground">{intentError}</div>
        )}

        {/* Once we have a clientSecret, keep <Elements> mounted until the dialog closes. */}
        {publishableKey && stripePromise && frozenElementsOptions && frozenClientSecret && (
          <Elements stripe={stripePromise} options={frozenElementsOptions}>
            <StripePayInner clientSecret={frozenClientSecret} onClose={close} onSettled={props.onSettled} />
          </Elements>
        )}

        {publishableKey && stripePromise && !loadingIntent && !hasClientSecret ? (
          <DialogFooter>
            <Button variant="outline" onClick={close}>
              Close
            </Button>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
