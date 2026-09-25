import { jest } from '@jest/globals';
import { stripeDiagnosticHandler } from '../services/stripePaymentDiagnostics';
import { safeStripeDiagnosticError, stripeDiagnosticBatchSchema } from '../../shared/stripePaymentDiagnostics';

const batch = () => ({ sessionId: 'd27ead56-687b-4e7e-9886-7e06962f6943', surface: 'guest_invoice', events: [{ event: 'submit_result', sequence: 1, timestamp: new Date().toISOString(), width: 390, height: 400, mountCount: 1, ready: true, success: false }] });
function response() { return { sendStatus: jest.fn() }; }
test('records server-authorized tenant/invoice only and reconstructs error text', async () => {
  const write = jest.fn();
  const scope = jest.fn<any>().mockResolvedValue({ organizationId: 'tenant-authorized', invoiceId: 'invoice-authorized' });
  const body: any = batch(); body.events[0].error = { code: 'incomplete_expiry', type: 'validation_error', message: '4242424242424242 12/39 RAW_CVC secret_do_not_log' };
  const res = response();
  await stripeDiagnosticHandler(scope, ['guest_invoice'], write)({ body, headers: {} } as any, res as any);
  expect(res.sendStatus).toHaveBeenCalledWith(204);
  expect(write.mock.calls[0][0]).toMatchObject({ organizationId: 'tenant-authorized', invoiceId: 'invoice-authorized' });
  const logged = JSON.stringify(write.mock.calls);
  for (const value of ['4242424242424242', '12/39', 'RAW_CVC', 'secret_do_not_log']) expect(logged).not.toContain(value);
  expect(logged).toContain('Your card expiration date is incomplete.');
});
test.each(['cardNumber', 'cvc', 'expiry', 'clientSecret', 'rawEvent', 'organizationId'])('rejects unsolicited field %s without logging', async (field) => {
  const write = jest.fn(), scope = jest.fn<any>(), res = response();
  await stripeDiagnosticHandler(scope, ['guest_invoice'], write)({ body: { ...batch(), [field]: 'not allowed' }, headers: {} } as any, res as any);
  expect(res.sendStatus).toHaveBeenCalledWith(400); expect(scope).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled();
});
test('unauthorized invoice and wrong surface cannot log', async () => {
  const write = jest.fn(), res = response(), scope = jest.fn<any>().mockResolvedValue(null);
  await stripeDiagnosticHandler(scope, ['guest_invoice'], write)({ body: batch(), headers: {} } as any, res as any);
  expect(res.sendStatus).toHaveBeenCalledWith(404); expect(write).not.toHaveBeenCalled();
  await stripeDiagnosticHandler(scope, ['staff_payment'], write)({ body: batch(), headers: {} } as any, res as any);
  expect(res.sendStatus).toHaveBeenCalledWith(400);
});
test('payload and batch limits are enforced', async () => {
  const res = response(), scope = jest.fn<any>();
  await stripeDiagnosticHandler(scope, ['guest_invoice'])({ body: batch(), headers: { 'content-length': '20000' } } as any, res as any);
  expect(res.sendStatus).toHaveBeenCalledWith(413); expect(scope).not.toHaveBeenCalled();
  expect(stripeDiagnosticBatchSchema.safeParse({ ...batch(), events: Array(21).fill(batch().events[0]) }).success).toBe(false);
});
test('sink failures fail softly without error payloads', async () => {
  const res = response();
  await stripeDiagnosticHandler(async () => ({ organizationId: 'tenant', invoiceId: 'invoice' }), ['guest_invoice'], () => { throw new Error('private'); })({ body: batch(), headers: {} } as any, res as any);
  expect(res.sendStatus).toHaveBeenCalledWith(204);
});
test('unknown provider metadata is replaced by fixed safe values', () => {
  expect(safeStripeDiagnosticError({ code: 'secret_do_not_log', type: '4242424242424242', message: '12/39' })).toEqual({ code: 'unknown', type: 'unknown', message: 'Stripe reported an error; review the payment form.' });
});
