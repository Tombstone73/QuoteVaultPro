import { createStripePaymentDiagnostics } from './stripePaymentDiagnostics';
import { apiFetch } from '@/lib/queryClient';
jest.mock('@/lib/queryClient', () => ({ apiFetch: jest.fn() }));
beforeEach(() => {
  jest.useFakeTimers(); jest.clearAllMocks();
  Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: () => 'd27ead56-687b-4e7e-9886-7e06962f6943' });
  (apiFetch as jest.Mock).mockResolvedValue({ ok: true });
});
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });
test.each([
  ['/api/guest/invoices', false, 'guest_invoice'],
  ['/api/portal/invoices', false, 'portal_invoice'],
  ['/api/portal/invoices', true, 'grouped_portal_invoices'],
  ['/api/invoices', false, 'staff_payment'],
])('classifies %s without putting invoice/link authority in the body', (base, grouped, surface) => {
  const diagnostics = createStripePaymentDiagnostics(String(base), 'private-link-authority', Boolean(grouped));
  diagnostics.emit('dialog_open'); diagnostics.flush();
  const body = JSON.parse((apiFetch as jest.Mock).mock.calls[0][1].body);
  expect(body.surface).toBe(surface); expect(JSON.stringify(body)).not.toContain('private-link-authority');
});
test('bounds event batches and session volume while reserving a close event', () => {
  const diagnostics = createStripePaymentDiagnostics('/api/invoices', 'invoice');
  for (let i = 0; i < 200; i++) diagnostics.emit('element_change', { complete: i % 2 === 0, empty: false });
  diagnostics.emit('dialog_close');
  const batches = (apiFetch as jest.Mock).mock.calls.map(([, request]) => JSON.parse(request.body));
  expect(batches.every(b => b.events.length <= 20)).toBe(true);
  expect(batches.flatMap(b => b.events)).toHaveLength(81);
  expect(batches.at(-1).events.at(-1).event).toBe('dialog_close');
});
test('a synchronous transport exception cannot escape; hung delivery aborts', () => {
  (apiFetch as jest.Mock).mockImplementationOnce(() => { throw new Error('offline'); });
  const diagnostics = createStripePaymentDiagnostics('/api/invoices', 'invoice');
  expect(() => { diagnostics.emit('dialog_open'); diagnostics.flush(); }).not.toThrow();
  (apiFetch as jest.Mock).mockImplementationOnce(() => new Promise(() => {}));
  diagnostics.emit('element_ready'); diagnostics.flush();
  const signal = (apiFetch as jest.Mock).mock.calls.at(-1)[1].signal;
  jest.advanceTimersByTime(5000);
  expect(signal.aborted).toBe(true);
});
test('older iPhones without randomUUID still get a valid correlation ID', () => {
  Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: undefined });
  const diagnostics = createStripePaymentDiagnostics('/api/invoices', 'invoice');
  diagnostics.emit('dialog_open'); diagnostics.flush();
  expect((apiFetch as jest.Mock).mock.calls).toHaveLength(1);
  expect(diagnostics.sessionId).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
});
