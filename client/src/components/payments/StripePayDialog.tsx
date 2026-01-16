import { useEffect, useRef, useState } from 'react';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { getStripePromise } from '@/lib/stripeClient';

const DEV = Boolean((import.meta as any).env?.DEV);

/**
 * Generate a unique session ID for debugging Elements lifecycle.
 * Each dialog open gets a new session ID.
 */
let sessionCounter = 0;
function nextSessionId() {
  return `stripe-session-${++sessionCounter}`;
}

/**
 * Inner component that renders the PaymentElement and handles payment confirmation.
 * 
 * CRITICAL: Must remain mounted once rendered to prevent Stripe Elements from unmounting.
 * confirmPayment requires a mounted PaymentElement; calling it before onReady throws.
 */
function StripePayInner(props: {
  invoiceId: string;
  clientSecret: string;
  onClose: () => void;
  onSettled: () => void;
  sessionId: string;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const { toast } = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [paymentElementReady, setPaymentElementReady] = useState(false);

  const confirmAttemptRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    if (DEV) {
      console.log('[StripePayDialog] StripePayInner mounted', { sessionId: props.sessionId });
    }
    return () => {
      mountedRef.current = false;
      if (DEV) {
        console.log('[StripePayDialog] StripePayInner unmounting', { sessionId: props.sessionId });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (DEV) {
      console.log('[StripePayDialog] clientSecret changed (inner)', {
        sessionId: props.sessionId,
        clientSecret: `${props.clientSecret.slice(0, 12)}…`,
      });
    }
    // Reset ready state if clientSecret changes (new intent).
    setPaymentElementReady(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.clientSecret]);

  useEffect(() => {
    if (!DEV) return;
    const hasStripe = Boolean(stripe);
    const hasElements = Boolean(elements);
    const hasPaymentEl = Boolean(elements?.getElement(PaymentElement));
    console.log('[StripePayDialog] readiness check', {
      sessionId: props.sessionId,
      hasStripe,
      hasElements,
      paymentElementReady,
      hasPaymentEl,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    if (DEV) {
      console.log('[StripePayDialog] Pay clicked', { sessionId: props.sessionId, attempt });
    }

    // Guard: confirmPayment requires a mounted PaymentElement.
    if (!stripe || !elements || !props.clientSecret) {
      if (DEV) console.log('[StripePayDialog] confirm blocked (missing stripe/elements/clientSecret)');
      return;
    }
    const paymentElement = elements.getElement(PaymentElement);
    if (!paymentElementReady || !paymentElement) {
      if (DEV) {
        console.log('[StripePayDialog] confirm blocked (PaymentElement not ready)', {
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

    if (DEV) {
      console.log('[StripePayDialog] confirmPayment starting', {
        sessionId: props.sessionId,
        attempt,
        hasStripe: Boolean(stripe),
        hasElements: Boolean(elements),
        hasPaymentEl: Boolean(paymentElement),
      });
    }

    setSubmitting(true);
    try {
      // Validate form data before confirming
      const submitResult = await elements.submit();
      if (submitResult.error) {
        toast({
          title: 'Validation failed',
          description: submitResult.error.message || 'Please check your payment details.',
          variant: 'destructive',
        });
        return;
      }

      const result = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: window.location.href,
        },
        redirect: 'if_required',
      });

      if (DEV) {
        console.log('[StripePayDialog] confirmPayment result', {
          sessionId: props.sessionId,
          hasError: Boolean(result.error),
          errorType: result.error?.type,
          paymentIntentId: result.paymentIntent?.id,
          paymentIntentStatus: result.paymentIntent?.status,
        });
      }

      if (result.error) {
        toast({
          title: 'Payment failed',
          description: result.error.message || 'Please try again.',
          variant: 'destructive',
        });
        return;
      }

      // If payment succeeded, immediately confirm with server to update payment record
      // This avoids waiting for webhook and ensures UI updates immediately
      if (result.paymentIntent) {
        try {
          const confirmRes = await fetch(`/api/invoices/${props.invoiceId}/payments/stripe/confirm`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ paymentIntentId: result.paymentIntent.id }),
            credentials: 'include',
          });

          if (!confirmRes.ok) {
            console.warn('[StripePayDialog] Confirm endpoint failed, relying on webhook', {
              status: confirmRes.status,
              sessionId: props.sessionId,
            });
          } else {
            const confirmData = await confirmRes.json();
            if (DEV) {
              console.log('[StripePayDialog] Payment confirmed', {
                sessionId: props.sessionId,
                updated: confirmData?.data?.updated,
                paymentStatus: confirmData?.data?.paymentStatus,
              });
            }
          }
        } catch (confirmErr) {
          console.warn('[StripePayDialog] Confirm call failed, relying on webhook', confirmErr);
        }
      }

      toast({
        title: 'Payment succeeded',
        description: 'Invoice has been updated with your payment.',
      });

      // Trigger immediate refresh before closing dialog
      props.onSettled();
      
      // Close dialog after a brief delay to ensure refetch completes
      setTimeout(() => {
        props.onClose();
      }, 500);
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
            if (DEV) {
              console.log('[StripePayDialog] PaymentElement onReady fired', {
                sessionId: props.sessionId,
              });
            }
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

/**
 * Stripe payment dialog for paying invoices via Stripe Elements.
 * 
 * LIFECYCLE GUARANTEES:
 * 1. loadStripe() is called exactly once per (publishableKey + stripeAccountId) pair (singleton).
 * 2. Payment intent is created exactly once per dialog open.
 * 3. <Elements> options object is frozen for the lifetime of the open dialog.
 * 4. <Elements> and <PaymentElement> mount once and stay mounted until close.
 * 5. confirmPayment only runs from explicit Pay button click.
 * 
 * WHY THIS MATTERS:
 * - Stripe Elements will remount if options identity changes, causing UI flash.
 * - confirmPayment throws if PaymentElement is not mounted.
 * - Multiple intent creations waste API calls and confuse payment tracking.
 * - Server creates PaymentIntent on connected account; client MUST initialize
 *   Stripe.js with same stripeAccount context or Elements session will 400.
 */
export default function StripePayDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoiceId: string;
  stripeAccountId?: string | null;
  disabled?: boolean;
  onSettled: () => void;
}) {
  const publishableKey = (import.meta as any).env?.VITE_STRIPE_PUBLISHABLE_KEY as string | undefined;

  // Singleton Stripe.js promise (cached by key + account).
  // CRITICAL: Must match the stripeAccount used when creating the PaymentIntent on the server.
  const stripePromise = getStripePromise(publishableKey, props.stripeAccountId);

  const { toast } = useToast();

  // State machine for dialog lifecycle
  const [state, setState] = useState<'idle' | 'creating_intent' | 'ready' | 'error'>('idle');
  const [intentError, setIntentError] = useState<string | null>(null);

  // Freeze clientSecret and Elements options for the lifetime of an open dialog.
  // This prevents <Elements> from being unmounted/remounted due to state changes.
  const clientSecretRef = useRef<string | null>(null);
  const elementsOptionsRef = useRef<{ clientSecret: string } | null>(null);
  const sessionIdRef = useRef<string | null>(null);

  // Track if intent request has been initiated for this open session.
  const intentRequestedRef = useRef(false);

  const frozenClientSecret = clientSecretRef.current;
  const frozenElementsOptions = elementsOptionsRef.current;
  const currentSessionId = sessionIdRef.current;

  useEffect(() => {
    if (DEV) {
      console.log('[StripePayDialog] Dialog open changed', {
        open: props.open,
        stripeAccountId: props.stripeAccountId || 'platform',
      });
    }

    if (!props.open) {
      // Dialog closed - reset everything for next open.
      if (DEV && sessionIdRef.current) {
        console.log('[StripePayDialog] Dialog closed, resetting state', {
          sessionId: sessionIdRef.current,
        });
      }
      setState('idle');
      setIntentError(null);
      clientSecretRef.current = null;
      elementsOptionsRef.current = null;
      sessionIdRef.current = null;
      intentRequestedRef.current = false;
      return;
    }

    // Dialog opened
    if (!props.invoiceId) return;
    if (intentRequestedRef.current) return;

    // Start a new payment session.
    intentRequestedRef.current = true;
    const sessionId = nextSessionId();
    sessionIdRef.current = sessionId;

    if (DEV) {
      console.log('[StripePayDialog] create-intent requested', {
        invoiceId: props.invoiceId,
        sessionId,
        stripeAccountId: props.stripeAccountId || 'platform',
      });
    }

    const run = async () => {
      setState('creating_intent');
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

        if (DEV) {
          console.log('[StripePayDialog] clientSecret received', {
            sessionId,
            clientSecret: `${secret.slice(0, 12)}…`,
          });
        }

        // Freeze the secret + options ONCE; never overwrite while the dialog is open.
        clientSecretRef.current = secret;
        elementsOptionsRef.current = { clientSecret: secret };
        setState('ready');
      } catch (e: any) {
        const message = e?.message || 'Please try again.';
        if (DEV) {
          console.error('[StripePayDialog] create-intent failed', { sessionId, error: message });
        }
        toast({
          title: 'Unable to start payment',
          description: message,
          variant: 'destructive',
        });
        setIntentError(message);
        setState('error');
      }
    };

    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.open, props.invoiceId]);

  const close = () => props.onOpenChange(false);

  // Never render Elements until we have a frozen clientSecret and Stripe.js is ready.
  // Once rendered, keep it mounted until dialog closes to prevent lifecycle issues.
  const shouldRenderElements = state === 'ready' && stripePromise && frozenElementsOptions && frozenClientSecret;

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

        {publishableKey && state === 'creating_intent' && (
          <div className="text-sm text-muted-foreground">Loading payment form…</div>
        )}

        {publishableKey && state === 'error' && intentError && (
          <div className="text-sm text-destructive">{intentError}</div>
        )}

        {/* Once we have a clientSecret, keep <Elements> mounted until the dialog closes. */}
        {shouldRenderElements && (
          <Elements stripe={stripePromise!} options={frozenElementsOptions!}>
            <StripePayInner
              invoiceId={props.invoiceId}
              clientSecret={frozenClientSecret!}
              onClose={close}
              onSettled={props.onSettled}
              sessionId={currentSessionId!}
            />
          </Elements>
        )}

        {/* Show close button if no Elements rendered */}
        {publishableKey && !shouldRenderElements && (
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
