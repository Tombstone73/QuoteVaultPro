import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import StripePayDialog from './StripePayDialog';
import { apiFetch } from '@/lib/queryClient';

let handlers: any;
let mounts = 0;
let unmounts = 0;
const submit = jest.fn();
const confirmPayment = jest.fn();
const toast = jest.fn();
const stripe = { confirmPayment };
const elements = { submit, getElement: () => ({}) };
const stablePromise = Promise.resolve(stripe);
let root: Root;
let container: HTMLDivElement;
const screen = {
  getByRole: (role: string, options?: { name: string; exact: boolean }) => {
    const found = Array.from(document.querySelectorAll(role === 'button' ? 'button' : `[role="${role}"]`)).find(e => !options || e.textContent === options.name);
    if (!found) throw new Error(`Missing ${role}`);
    return found as HTMLElement;
  },
  findByRole: async (role: string) => { await act(async () => {}); return screen.getByRole(role); },
  findByTestId: async (id: string) => { await act(async () => {}); const el = document.querySelector(`[data-testid="${id}"]`); if (!el) throw new Error('Missing fixture'); return el; },
};
const fireEvent = { click: (el: HTMLElement) => act(() => Simulate.click(el)) };
const render = (element: React.ReactElement) => { act(() => root.render(element)); return { rerender: (next: React.ReactElement) => act(() => root.render(next)) }; };
const waitFor = async (check: () => void) => { await act(async () => {}); check(); };
jest.mock('@/lib/queryClient', () => ({ apiFetch: jest.fn() }));
jest.mock('@/lib/stripeClient', () => ({ getStripePromise: () => stablePromise }));
jest.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }));
jest.mock('@stripe/react-stripe-js', () => ({
  Elements: ({ children }: any) => children,
  useStripe: () => stripe,
  useElements: () => elements,
  PaymentElement: (props: any) => {
    handlers = props;
    React.useEffect(() => { mounts++; return () => { unmounts++; }; }, []);
    return <div data-testid="hosted-payment-element">Hosted Stripe fixture</div>;
  },
}));

const props = { open: true, onOpenChange: jest.fn(), invoiceId: 'invoice-fixture', apiBasePath: '/api/guest/invoices', onSettled: jest.fn().mockResolvedValue({ reconciled: true }) };
const events = () => (apiFetch as jest.Mock).mock.calls.flatMap(([, request]) => JSON.parse(request.body).events);
async function openDialog() {
  const result = render(<StripePayDialog {...props} />);
  await screen.findByTestId('hosted-payment-element');
  act(() => handlers.onReady());
  return result;
}
async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 800)); }); }

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  jest.clearAllMocks(); mounts = 0; unmounts = 0;
  Object.defineProperty(globalThis.crypto, 'randomUUID', { configurable: true, value: () => 'd27ead56-687b-4e7e-9886-7e06962f6943' });
  (apiFetch as jest.Mock).mockResolvedValue({ ok: true });
  global.fetch = jest.fn().mockImplementation(async (url) => ({ ok: true, json: async () => ({ data: String(url).endsWith('runtime-config')
    ? { provider: 'stripe', mode: 'test', publishableKey: 'pk_test_fixture', connectedAccountId: 'acct_fixture', readyForPayments: true }
    : { clientSecret: 'secret_do_not_log', stripeAccountId: 'acct_fixture' } }) }));
  submit.mockResolvedValue({});
  confirmPayment.mockResolvedValue({ error: { type: 'card_error', code: 'card_declined', message: 'Your card was declined.' } });
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

test('ready, completeness transitions, resize and rerender preserve the mounted field and safe correlation', async () => {
  const view = await openDialog();
  act(() => {
    handlers.onChange({ elementType: 'payment', complete: false, empty: false, value: { number: '4242424242424242', cvc: 'RAW_CVC', expiry: '12/39', client_secret: 'secret_do_not_log' } });
    handlers.onChange({ elementType: 'payment', complete: false, empty: false });
    handlers.onChange({ elementType: 'payment', complete: true, empty: false });
    window.dispatchEvent(new Event('resize'));
  });
  view.rerender(<StripePayDialog {...props} invoiceIds={['invoice-fixture']} />);
  await flush();
  expect(mounts).toBe(1); expect(unmounts).toBe(0);
  expect(events().filter(e => e.event === 'element_change')).toHaveLength(2);
  expect(events().find(e => e.event === 'element_mount').mountCount).toBe(1);
  expect(events().find(e => e.event === 'element_ready').ready).toBe(true);
  expect((screen.getByRole('button', { name: 'Pay', exact: true }) as HTMLButtonElement).disabled).toBe(false);
  const payload = JSON.stringify((apiFetch as jest.Mock).mock.calls);
  for (const forbidden of ['4242424242424242', 'RAW_CVC', '12/39', 'secret_do_not_log', 'client_secret', '"value"']) expect(payload).not.toContain(forbidden);
  const batches = (apiFetch as jest.Mock).mock.calls.map(([, request]) => JSON.parse(request.body));
  expect(new Set(batches.map(b => b.sessionId)).size).toBe(1);
  expect(batches[0].surface).toBe('guest_invoice');
  view.rerender(<StripePayDialog {...props} open={false} />);
  expect(events().some(e => e.event === 'dialog_close')).toBe(true);
});

test('submit validation feedback stays visible and confirmation is never attempted', async () => {
  submit.mockResolvedValue({ error: { type: 'validation_error', code: 'incomplete_expiry', message: 'Your card expiration date is incomplete.' } });
  await openDialog();
  fireEvent.click(screen.getByRole('button', { name: 'Pay', exact: true }));
  await screen.findByRole('alert');
  expect(screen.getByRole('alert').textContent).toContain('expiration date is incomplete');
  expect(confirmPayment).not.toHaveBeenCalled();
  await flush();
  expect(events().find(e => e.event === 'submit_result')).toMatchObject({ success: false, error: { code: 'incomplete_expiry', type: 'validation_error' } });
});

test('confirm errors are captured and failed telemetry does not block Stripe confirmation', async () => {
  (apiFetch as jest.Mock).mockRejectedValue(new Error('offline'));
  await openDialog();
  fireEvent.click(screen.getByRole('button', { name: 'Pay', exact: true }));
  await screen.findByRole('alert');
  await flush();
  expect(confirmPayment).toHaveBeenCalledTimes(1);
  expect(events().find(e => e.event === 'confirm_result')).toMatchObject({ success: false, error: { code: 'card_declined' } });
  expect((screen.getByRole('button', { name: 'Pay', exact: true }) as HTMLButtonElement).disabled).toBe(false);
});

test('load errors use safe metadata and unknown raw messages never enter diagnostics', async () => {
  await openDialog();
  act(() => handlers.onLoadError({ error: { type: 'api_error', code: 'unexpected_private_code', message: 'secret_do_not_log', payment_method: { card: '4242424242424242' } } }));
  await flush();
  expect(events().find(e => e.event === 'element_load_error')).toMatchObject({ ready: false, error: { code: 'unknown', type: 'api_error' } });
  expect(JSON.stringify((apiFetch as jest.Mock).mock.calls)).not.toContain('secret_do_not_log');
});

test('a rejected submit promise releases Processing and does not confirm', async () => {
  submit.mockRejectedValue(new Error('private provider exception'));
  await openDialog();
  fireEvent.click(screen.getByRole('button', { name: 'Pay', exact: true }));
  await waitFor(() => expect((screen.getByRole('button', { name: 'Pay', exact: true }) as HTMLButtonElement).disabled).toBe(false));
  expect(confirmPayment).not.toHaveBeenCalled();
  expect(screen.getByRole('alert').textContent).toContain('check your connection');
});

test('successful confirmation still uses the existing settlement callback and emits success', async () => {
  confirmPayment.mockResolvedValue({ paymentIntent: { id: 'pi_fixture', status: 'succeeded' } });
  await openDialog();
  fireEvent.click(screen.getByRole('button', { name: 'Pay', exact: true }));
  await flush();
  expect(props.onSettled).toHaveBeenCalledWith({ serverConfirmed: false, paymentIntentId: 'pi_fixture' });
  expect(events().some(e => e.event === 'submit_result' && e.success)).toBe(true);
  expect(events().some(e => e.event === 'confirm_result' && e.success)).toBe(true);
  expect(events().some(e => e.event === 'dialog_success')).toBe(true);
  expect(JSON.stringify((apiFetch as jest.Mock).mock.calls)).not.toContain('pi_fixture');
});
