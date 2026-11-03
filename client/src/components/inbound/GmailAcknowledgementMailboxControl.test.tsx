import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { GmailAcknowledgementMailboxControl } from './GmailAcknowledgementMailboxControl';
import type { InboundEmailMailboxView } from '@shared/inboundEmailMailboxes';
jest.mock('@/lib/queryClient', () => ({ apiRequest: jest.fn() }));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement, client: QueryClient;
const request = apiRequest as jest.Mock;
beforeEach(() => { request.mockReset(); host = document.createElement('div'); document.body.append(host); root = createRoot(host); client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); });
afterEach(() => { act(() => root.unmount()); client.clear(); host.remove(); });
async function render(reason: string | null, patch: Partial<InboundEmailMailboxView> = {}) {
  const onChange = jest.fn();
  request.mockResolvedValue({ json: async () => ({ rollout: { enabled: reason === null, reason, message: reason ? `Operational ${reason}. Cannot override here.` : 'Operationally enabled', organizationId: 'tenant' },
    mailboxes: [{ mailboxId: 'mailbox', pendingCount: 3, failedCount: 1, lastSucceededAt: '2026-11-02T12:00:00Z', lastError: 'Reconnect the same Gmail account, then retry.' }] }) });
  const mailbox = { id: 'mailbox', provider: 'gmail', emailAddress: 'qa@example.invalid', enabled: true, acknowledgementPermission: 'available', settings: { gmailAcknowledgementEnabled: true }, ...patch } as InboundEmailMailboxView;
  await act(async () => { root.render(<QueryClientProvider client={client}><GmailAcknowledgementMailboxControl mailbox={mailbox} disabled={false} onChange={onChange} /></QueryClientProvider>); await new Promise(resolve => setTimeout(resolve, 30)); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); }); return onChange;
}
test.each(['global_pause','worker_pause','tenant_not_enrolled'])('shows %s independently of a saved mailbox opt-in', async reason => {
  await render(reason); expect(host.textContent).toContain('Paused'); expect(host.textContent).toContain(reason);
  expect(host.textContent).toContain('Cannot override here'); expect(host.textContent).toContain('Pending: 3'); expect(host.textContent).toContain('Failed / needs attention: 1');
  expect(host.textContent).toContain('Last successful acknowledgement:'); expect(request.mock.calls.every(call => call[0] === 'GET')).toBe(true);
});
test('permission and tenant-controlled pause remain distinct from operational enrollment', async () => {
  await render(null, { acknowledgementPermission: 'reconnect_required' }); expect(host.textContent).toContain('Permission Required');
  expect(host.textContent).toContain('Reconnect this same mailbox');
});
test('enabled requires every gate and the preference does not change optimistically', async () => {
  await render(null); expect(host.textContent).toContain('Enabled');
  const onChange = await render(null, { settings: { gmailAcknowledgementEnabled: false } as InboundEmailMailboxView['settings'] });
  expect(host.textContent).toContain('tenant-controlled preference');
  act(() => { (host.querySelector('[role="switch"]') as HTMLButtonElement).click(); });
  expect(onChange).toHaveBeenCalledWith(true); expect(host.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('false');
});

test('a failed operational refresh never reports Enabled from stale success data',async()=>{
  await render(null);expect(host.textContent).toContain('Enabled');
  request.mockRejectedValue(new Error('Synthetic overview outage'));
  await act(async()=>{await client.invalidateQueries({queryKey:['/api/inbound-orders/gmail-acknowledgements/overview']});await new Promise(r=>setTimeout(r,20));});
  await act(async()=>{await new Promise(r=>setTimeout(r,20));});
  expect(host.textContent).toContain('Operational activation status is unavailable');
  expect(host.textContent).toContain('Paused');
  expect(host.textContent).not.toContain('Pending: 0');
});
