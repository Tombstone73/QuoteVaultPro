import { useEffect, useRef, useState } from 'react';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { getStripePromise } from '@/lib/stripeClient';
import { isStripePaymentConfirmSucceeded, type StripePaymentConfirmResponse } from '@shared/stripePaymentConfirm';

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
  /** Grouped checkout data; provider authorization is owned by the parent batch. */
  invoiceIds?: string[];
  invoiceSummaries?: Array<{ invoiceNumber: string; amountDue: number; currency?: string }>;
  groupedInitiation?: boolean;
  developerPreviewPayment?: boolean;
  clientSecret: string;
  apiBasePath: string;
  onClose: () => void;
  onSettled: (result: { serverConfirmed: boolean; paymentIntentId: string }) => Promise<{ reconciled: boolean }>;
  sessionId: string;
}) {
  const isMultiInvoice = (props.invoiceIds?.length || 1) > 1;
  const stripe = useStripe();
  const elements = useElements();
  const { toast } = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [awaitingReconciliation, setAwaitingReconciliation] = useState(false);
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
        hasClientSecret: Boolean(props.clientSecret),
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

      let serverConfirmed = false;

      // Frontend success is only a UX signal. The server confirms the PaymentIntent
      // with Stripe and refreshes invoice state before the UI refetches.
      if (result.paymentIntent) {
        try {
          const confirmUrl = props.groupedInitiation
            ? '/api/portal/payments/stripe/confirm'
            : `${props.apiBasePath}/${props.invoiceId}/payments/stripe/confirm`;
          const confirmRes = await fetch(confirmUrl, {
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
            const confirmData = await confirmRes.json() as StripePaymentConfirmResponse & { data?: { finalized?: boolean } };
            if (props.groupedInitiation ? confirmData?.data?.finalized === true : isStripePaymentConfirmSucceeded(confirmData)) {
              serverConfirmed = true;
              if (DEV) {
                console.log('[StripePayDialog] Payment confirmed', {
                  sessionId: props.sessionId,
                  paymentStatus: confirmData.data.paymentStatus,
                });
              }
            }
          }
        } catch (confirmErr) {
          console.warn('[StripePayDialog] Confirm call failed, relying on webhook', confirmErr);
        }
      }

      toast({
        title: serverConfirmed ? 'Payment confirmed' : 'Payment submitted',
        description: serverConfirmed
          ? 'Your invoice has been updated.'
          : 'Your payment was submitted and is awaiting processor reconciliation.',
      });

      // Always fetch server-authoritative invoice state before settling the
      // dialog. A failed confirmation remains safely convergent via webhook,
      // but must not silently close onto a stale invoice.
      let reconciled = false;
      try {
        reconciled = (await props.onSettled({
          serverConfirmed,
          paymentIntentId: result.paymentIntent.id,
        })).reconciled;
      } catch (refreshError) {
        console.warn('[StripePayDialog] Settlement refresh failed', refreshError);
      }

      if (reconciled) {
        // Close only after the authoritative invoice and payment-history fetch
        // has observed the canonical succeeded payment.
        setTimeout(() => {
          props.onClose();
        }, 500);
      } else if (mountedRef.current) {
        setAwaitingReconciliation(true);
        toast({
          title: 'Payment received',
          description: 'Waiting for processor reconciliation. This invoice will remain open until its payment state is confirmed.',
        });
      }
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
        {awaitingReconciliation ? (
          <div className="text-sm text-muted-foreground" role="status">
            Payment received. Waiting for processor reconciliation…
          </div>
        ) : null}
      </div>
      {props.developerPreviewPayment ? (
        <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm font-medium text-amber-950">
          Developer preview: payment submission enabled. This will create a real payment.
        </p>
      ) : null}
      <DialogFooter>
        <Button variant="outline" onClick={props.onClose} disabled={submitting}>
          Close
        </Button>
        <Button
          onClick={handleConfirm}
          disabled={!stripe || !elements || !props.clientSecret || !paymentElementReady || submitting || awaitingReconciliation}
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
  invoiceIds?: string[];
  invoiceSummaries?: Array<{ invoiceNumber: string; amountDue: number; currency?: string }>;
  apiBasePath: string;
  /** Uses the pending customer-payment-batch endpoint; allocation waits for reconciliation. */
  groupedInitiation?: boolean;
  disabled?: boolean;
  /** Staff preview stays read-only unless the server grants its explicit payment capability. */
  previewMode?: boolean;
  previewPaymentAuthorized?: boolean;
  onSettled: (result: { serverConfirmed: boolean; paymentIntentId: string }) => Promise<{ reconciled: boolean }>;
}) {
  const apiBasePath = props.apiBasePath;
  const isMultiInvoice = (props.invoiceIds?.length || 1) > 1;
  const [runtimeConfig, setRuntimeConfig] = useState<{
    provider: 'stripe';
    publishableKey: string;
    mode: 'test' | 'live';
    connectedAccountId: string;
    readyForPayments: true;
  } | null>(null);

  // The platform key and tenant Connect account are both returned by the
  // server after it has derived the authorized invoice scope. Never use a
  // Vite build variable or caller-provided connected-account ID here.
  const stripePromise = getStripePromise(runtimeConfig?.publishableKey, runtimeConfig?.connectedAccountId);

  const { toast } = useToast();

  // State machine for dialog lifecycle
  const [state, setState] = useState<'idle' | 'loading_runtime_config' | 'creating_intent' | 'ready' | 'preview' | 'error'>('idle');
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
  const checkoutIdempotencyKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (DEV) {
      console.log('[StripePayDialog] Dialog open changed', {
        open: props.open,
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
      checkoutIdempotencyKeyRef.current = null;
      setRuntimeConfig(null);
      return;
    }

    // Dialog opened
    if (!props.invoiceId) return;
    if (props.previewMode && !props.previewPaymentAuthorized) {
      setState('preview');
      setIntentError(null);
      return;
    }
    if (intentRequestedRef.current) return;
    // Start a new payment session.
    intentRequestedRef.current = true;
    const sessionId = nextSessionId();
    sessionIdRef.current = sessionId;
    checkoutIdempotencyKeyRef.current = typeof crypto?.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${sessionId}-${Date.now()}`;

    if (DEV) {
      console.log('[StripePayDialog] runtime configuration requested', {
        invoiceId: props.invoiceId,
        sessionId,
      });
    }

    const run = async () => {
      setState('loading_runtime_config');
      setIntentError(null);
      try {
        const configRes = await fetch(`${apiBasePath}/${props.invoiceId}/payments/stripe/runtime-config`, {
          method: 'GET',
          credentials: 'include',
        });
        const configJson = await configRes.json().catch(() => ({}));
        if (!configRes.ok) throw new Error((configJson as any)?.message || (configJson as any)?.error || 'Stripe is unavailable for this invoice');

        const config = (configJson as any)?.data;
        const validMode = config?.mode === 'test' || config?.mode === 'live';
        const expectedPrefix = config?.mode === 'test' ? 'pk_test_' : 'pk_live_';
        if (config?.provider !== 'stripe' || !validMode || typeof config?.publishableKey !== 'string'
          || !config.publishableKey.startsWith(expectedPrefix) || typeof config?.connectedAccountId !== 'string'
          || !config.connectedAccountId.trim() || config?.readyForPayments !== true) {
          throw new Error('Stripe payment configuration is unavailable for this invoice.');
        }

        const frozenConfig = {
          provider: 'stripe' as const,
          publishableKey: config.publishableKey,
          mode: config.mode as 'test' | 'live',
          connectedAccountId: config.connectedAccountId.trim(),
          readyForPayments: true as const,
        };
        setRuntimeConfig(frozenConfig);
        setState('creating_intent');

        const createIntentUrl = props.groupedInitiation
          ? '/api/portal/payments/stripe/create-intent'
          : `${apiBasePath}/${props.invoiceId}/payments/stripe/create-intent`;
        const expectedRemainingCents = Object.fromEntries((props.invoiceIds || [props.invoiceId]).map((invoiceId, index) => [
          invoiceId,
          Math.round(Number(props.invoiceSummaries?.[index]?.amountDue || 0) * 100),
        ]));
        const res = await fetch(createIntentUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: props.groupedInitiation ? JSON.stringify({
            invoiceIds: props.invoiceIds || [props.invoiceId],
            expectedRemainingCents,
            idempotencyKey: checkoutIdempotencyKeyRef.current,
          }) : undefined,
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error((json as any)?.message || (json as any)?.error || 'Failed to create payment intent');
        if ((json as any)?.data?.stale) throw new Error('One or more invoice balances changed. Refresh the invoices and review the updated total before paying.');

        const secret = (json as any)?.data?.clientSecret as string | undefined;
        if (!secret) throw new Error('Missing clientSecret');
        const nextStripeAccountId = (json as any)?.data?.stripeAccountId;
        if (typeof nextStripeAccountId !== 'string' || nextStripeAccountId.trim() !== frozenConfig.connectedAccountId) {
          throw new Error('Stripe payment account context changed. Please reopen the payment dialog.');
        }

        if (DEV) {
          console.log('[StripePayDialog] clientSecret received', {
            sessionId,
            hasClientSecret: Boolean(secret),
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
  }, [props.open, props.invoiceId, apiBasePath, props.previewMode, props.previewPaymentAuthorized, props.groupedInitiation, props.invoiceIds, props.invoiceSummaries]);

  const close = () => props.onOpenChange(false);

  // Never render Elements until we have a frozen clientSecret and Stripe.js is ready.
  // Once rendered, keep it mounted until dialog closes to prevent lifecycle issues.
  const shouldRenderElements = state === 'ready' && stripePromise && frozenElementsOptions && frozenClientSecret;

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden sm:max-h-[calc(100dvh-4rem)]">
        <DialogHeader className="shrink-0">
          <DialogTitle>{props.previewMode ? 'Payment preview' : isMultiInvoice ? 'Pay Selected Invoices' : 'Pay Invoice'}</DialogTitle>
        </DialogHeader>
        {isMultiInvoice ? <div className="flex min-h-0 shrink flex-col rounded-md border text-sm"><p className="shrink-0 px-3 pb-2 pt-3 font-medium">{props.invoiceIds?.length} invoices selected</p><div className="min-h-0 max-h-[min(15rem,32dvh)] space-y-2 overflow-y-auto overscroll-contain px-3 pb-3" data-testid="stripe-invoice-scroll-region">{props.invoiceSummaries?.map((invoice) => <div key={invoice.invoiceNumber} className="flex min-w-0 justify-between gap-4"><span className="min-w-0 truncate">Invoice {invoice.invoiceNumber}</span><span className="shrink-0">{new Intl.NumberFormat('en-US', { style: 'currency', currency: invoice.currency || 'USD' }).format(invoice.amountDue)}</span></div>)}</div><div className="flex shrink-0 justify-between gap-4 border-t px-3 py-3 font-semibold"><span>Total Due</span><span className="shrink-0">{new Intl.NumberFormat('en-US', { style: 'currency', currency: props.invoiceSummaries?.[0]?.currency || 'USD' }).format((props.invoiceSummaries || []).reduce((total, invoice) => total + invoice.amountDue, 0))}</span></div></div> : null}

        {(state === 'loading_runtime_config' || state === 'creating_intent') && (
          <div className="text-sm text-muted-foreground">Loading payment form…</div>
        )}

        {state === 'error' && intentError && (
          <div className="text-sm text-destructive">{intentError}</div>
        )}

        {state === 'preview' && (
          <div className="space-y-4">
            <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">Staff preview: payment submission disabled. No payment processor request, payment record, or invoice update will be created.</p>
            <div className="space-y-3 rounded-md border p-4" aria-label="Payment method preview">
              <p className="text-sm font-medium">Payment method</p>
              <div className="h-10 rounded border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">Card number</div>
              <div className="grid grid-cols-2 gap-3"><div className="h-10 rounded border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">MM / YY</div><div className="h-10 rounded border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">CVC</div></div>
            </div>
          </div>
        )}

        {/* Once we have a clientSecret, keep <Elements> mounted until the dialog closes. */}
        {shouldRenderElements && (
          <Elements stripe={stripePromise!} options={frozenElementsOptions!}>
        <StripePayInner
          invoiceId={props.invoiceId}
          invoiceIds={props.invoiceIds}
          invoiceSummaries={props.invoiceSummaries}
          groupedInitiation={props.groupedInitiation}
          developerPreviewPayment={Boolean(props.previewMode && props.previewPaymentAuthorized)}
              clientSecret={frozenClientSecret!}
              apiBasePath={apiBasePath}
              onClose={close}
              onSettled={props.onSettled}
              sessionId={currentSessionId!}
            />
          </Elements>
        )}

        {/* Show close button if no Elements rendered */}
        {!shouldRenderElements && state !== 'loading_runtime_config' && state !== 'creating_intent' && (
          <DialogFooter>
            <Button variant="outline" onClick={close}>
              Close
            </Button>
            {state === 'preview' ? <Button disabled>Staff preview: payment submission disabled</Button> : null}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
