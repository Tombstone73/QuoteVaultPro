import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, ShoppingCart } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { fileToBase64 } from '@/lib/uploads/fileToBase64';
import {
  PortalApiError, portalCartRequest, usePortalCart, usePortalSession,
  type PortalCartDto, type PortalCartReviewDto, type PortalCartSubmitDto,
} from '@/hooks/usePortal';

function money(cents: number, currency: string) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(cents / 100);
}

export default function PortalCartPage() {
  const queryClient = useQueryClient();
  const cartQuery = usePortalCart();
  const sessionQuery = usePortalSession();
  const [review, setReview] = useState<PortalCartReviewDto | null>(null);
  const [placed, setPlaced] = useState<Extract<PortalCartSubmitDto, { status: 'placed' }> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submissionKey = useRef<string | null>(null);
  const cart = cartQuery.data;
  const canOrder = sessionQuery.data?.permissions.canPlaceOrders === true;

  async function run(action: () => Promise<unknown>) {
    if (busy || !canOrder) return;
    setBusy(true);
    setError(null);
    try {
      await action();
      setReview(null);
      submissionKey.current = null;
      await queryClient.invalidateQueries({ queryKey: ['/api/portal/cart'] });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update the cart. Please retry.');
    } finally { setBusy(false); }
  }

  async function upload(lineId: string, file: File) {
    await run(async () => {
      if (file.size <= 0 || file.size > 1024 * 1024) throw new Error('Artwork must be 1 MB or smaller.');
      await portalCartRequest(`/items/${encodeURIComponent(lineId)}/files`, 'POST', {
        fileName: file.name, mimeType: file.type, dataBase64: await fileToBase64(file), note: null,
      });
    });
  }

  async function requestReview() {
    if (busy || !canOrder) return;
    setBusy(true);
    setError(null);
    try {
      const next = await portalCartRequest<PortalCartReviewDto>('/review', 'POST');
      setReview(next);
      submissionKey.current = crypto.randomUUID();
    } catch (cause) {
      setReview(null);
      setError(cause instanceof Error ? cause.message : 'Could not calculate checkout totals.');
    } finally { setBusy(false); }
  }

  async function placeOrder() {
    if (busy || !review || !canOrder) return;
    setBusy(true);
    setError(null);
    try {
      const key = submissionKey.current ?? crypto.randomUUID();
      submissionKey.current = key;
      const result = await portalCartRequest<PortalCartSubmitDto>('/submit', 'POST', {
        reviewToken: review.reviewToken, submissionKey: key,
      });
      if (result.status === 'changed') {
        setReview(result.review);
        submissionKey.current = crypto.randomUUID();
        setError('Product prices or tax changed. Review the updated total, then place the Order again.');
      } else {
        setPlaced(result);
        setReview(null);
        await queryClient.invalidateQueries({ queryKey: ['/api/portal/cart'] });
        await queryClient.invalidateQueries({ queryKey: ['/api/portal/orders'] });
      }
    } catch (cause) {
      // Keep the same submission key after a timeout, so a retry can only
      // recover the original Order. Re-review on a confirmed cart conflict.
      if (cause instanceof PortalApiError && cause.status === 409) {
        setReview(null);
        submissionKey.current = null;
      }
      setError(cause instanceof Error ? cause.message : 'Order submission failed. Retry safely.');
    } finally { setBusy(false); }
  }

  if (placed) return <div className="mx-auto max-w-3xl space-y-5">
    <h1 className="text-2xl font-semibold">Order received</h1>
    <Card><CardContent className="space-y-3 py-6">
      <p className="font-semibold">Order {placed.orderNumber}</p>
      <p>Total: {money(placed.totalCents, placed.currency)} · Pickup</p>
      <p>{placed.artworkStatus}. Production will begin after staff intake and approval.</p>
      <p>No payment was taken and no Invoice was sent during checkout.</p>
      <Button asChild><Link to={`/portal/orders/${encodeURIComponent(placed.orderId)}`}>View Order</Link></Button>
    </CardContent></Card>
  </div>;

  return <div className="mx-auto max-w-5xl space-y-5">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="flex items-center gap-2 text-2xl font-semibold"><ShoppingCart className="h-6 w-6" />Cart</h1>
        <p className="text-sm text-muted-foreground">Pickup only. Shipping is not yet offered through the portal.</p></div>
      <Button asChild variant="outline"><Link to="/portal/store">Continue shopping</Link></Button>
    </header>
    {error ? <p role="alert" className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">{error}</p> : null}
    {!canOrder ? <p className="rounded-md border p-3 text-sm">A Buyer or Company Admin portal account is required to order. Staff preview and Viewer access are read-only.</p> : null}
    {cartQuery.isPending ? <Loader2 className="animate-spin" aria-label="Loading cart" /> : cartQuery.isError ?
      <p role="alert">Could not load your cart. <Button variant="outline" onClick={() => void cartQuery.refetch()}>Retry</Button></p> :
      !cart?.lines.length ? <Card><CardContent className="py-8 text-center">Your cart is empty.</CardContent></Card> : <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-3">{cart.lines.map(line => <Card key={line.id}><CardHeader><CardTitle className="text-base">{line.productName}</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>Quantity {line.quantity}{line.widthIn && line.heightIn ? ` · ${line.widthIn} × ${line.heightIn} in` : ''}</p>
            {Object.keys(line.selections).length ? <p className="text-muted-foreground">Options: {Object.entries(line.selections).map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : String(value)}`).join(' · ')}</p> : null}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" asChild><Link to={`/portal/store/${encodeURIComponent(line.productId)}?cartLine=${encodeURIComponent(line.id)}`}>Edit configuration</Link></Button>
              <Button size="sm" variant="outline" disabled={busy || !canOrder} onClick={() => void run(() => portalCartRequest<PortalCartDto>(`/items/${encodeURIComponent(line.id)}`, 'DELETE'))}>Remove</Button>
            </div>
            <div className="border-t pt-3">
              <p className="mb-2 font-medium">Artwork for this item</p>
              {cart.files.filter(file => file.lineId === line.id).map(file => <div key={file.id} className="flex items-center justify-between gap-2 py-1">
                <span className="truncate">{file.fileName} · Pending staff review</span>
                <Button size="sm" variant="ghost" disabled={busy || !canOrder} onClick={() => void run(() => portalCartRequest<PortalCartDto>(`/files/${encodeURIComponent(file.id)}`, 'DELETE'))}>Remove</Button>
              </div>)}
              <label className="block cursor-pointer text-sm text-primary">Upload artwork now (PDF, JPG, PNG, TIFF; 1 MB max)
                <input type="file" accept=".pdf,.jpg,.jpeg,.png,.tif,.tiff" className="mt-2 block w-full text-xs" disabled={busy || !canOrder} onChange={event => { const file = event.target.files?.[0]; if (file) void upload(line.id, file); event.currentTarget.value = ''; }} />
              </label>
              <p className="mt-1 text-xs text-muted-foreground">You may send artwork later unless this Product requires it.</p>
            </div>
          </CardContent></Card>)}</div>
        <Card className="h-fit"><CardHeader><CardTitle className="text-base">Checkout</CardTitle></CardHeader><CardContent className="space-y-3 text-sm">
          <p>Pickup at the shop. Tax is calculated using the current policy.</p>
          {!review ? <Button className="w-full" disabled={busy || !canOrder} onClick={() => void requestReview()}>{busy ? 'Calculating…' : 'Review totals'}</Button> : <>
            <p className="font-medium">{review.pickupLocation.name}</p>
            <p>{review.pickupLocation.line1}, {review.pickupLocation.city}, {review.pickupLocation.state} {review.pickupLocation.postalCode}</p>
            {review.lines.map(line => <p key={line.id} className="flex justify-between gap-2"><span>{line.productName} × {line.quantity}</span><span>{money(line.totalCents, review.currency)}</span></p>)}
            <p className="flex justify-between"><span>Subtotal</span><span>{money(review.subtotalCents, review.currency)}</span></p>
            <p className="flex justify-between"><span>Tax</span><span>{money(review.taxCents, review.currency)}</span></p>
            <p className="flex justify-between font-semibold"><span>Total</span><span>{money(review.totalCents, review.currency)}</span></p>
            <p className="text-xs text-muted-foreground">Placing this Order creates an Invoice for staff review. It does not charge you or send the Invoice.</p>
            <Button className="w-full" disabled={busy || !canOrder} onClick={() => void placeOrder()}>{busy ? 'Placing Order…' : 'Place Order'}</Button>
            <Button className="w-full" variant="outline" disabled={busy} onClick={() => void requestReview()}>Refresh totals</Button>
          </>}
        </CardContent></Card>
      </div>}
  </div>;
}
