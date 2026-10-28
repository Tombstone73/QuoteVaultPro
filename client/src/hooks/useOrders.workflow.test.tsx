
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useUpdateOrderLineItem } from './useOrders';
import { apiFetch } from '@/lib/queryClient';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
jest.mock('react-router-dom', () => ({ useNavigate: () => jest.fn() }));
jest.mock('@/lib/queryClient', () => ({ apiFetch: jest.fn() }));
const toast = jest.fn();
jest.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }));
let root: Root, mutate: any;
function Harness() { mutate = useUpdateOrderLineItem('order'); return null; }
const request = { id: 'line', data: { requiresDesign: false, requiresPrepress: false, requiresProofApproval: true, expectedUpdatedAt: '2026-10-28T00:00:00.000Z' } };
const line = { id: 'line', requiresDesign: false, requiresPrepress: false, requiresProofApproval: true, updatedAt: '2026-10-28T00:00:01.000Z' };
beforeEach(() => {
  jest.clearAllMocks();
  const host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  act(() => root.render(<QueryClientProvider client={client}><Harness /></QueryClientProvider>));
});
afterEach(() => { act(() => root.unmount()); document.body.innerHTML = ''; });
test('success waits for a fresh Order read confirming every requested requirement', async () => {
  (apiFetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => line })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ lineItems: [line] }) });
  let result: any;
  await act(async () => { result = await mutate.mutateAsync(request); });
  expect(result).toEqual(line);
  expect((apiFetch as jest.Mock).mock.calls[1]).toEqual(['/api/orders/order', { credentials: 'include', cache: 'no-store' }]);
  expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Success' }));
});
test.each(['requiresProofApproval', 'requiresDesign', 'requiresPrepress'])('a discarded %s in the PATCH response cannot produce success', async field => {
  (apiFetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => ({ ...line, [field]: !line[field as keyof typeof line] }) });
  await act(async () => { await expect(mutate.mutateAsync(request)).rejects.toMatchObject({ code: 'ROUTING_SAVE_UNCONFIRMED' }); });
  expect(toast).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'Success' }));
});
test('a later authoritative mismatch is an error rather than a success', async () => {
  (apiFetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => line })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ lineItems: [{ ...line, requiresProofApproval: false }] }) });
  await act(async () => { await expect(mutate.mutateAsync(request)).rejects.toThrow('Proof approval'); });
  expect(toast).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'Success' }));
});
test('a failed readback preserves the unconfirmed result as an error', async () => {
  (apiFetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => line }).mockRejectedValueOnce(new Error('offline'));
  await act(async () => { await expect(mutate.mutateAsync(request)).rejects.toMatchObject({ code: 'ROUTING_SAVE_UNCONFIRMED' }); });
  expect(toast).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'Success' }));
});
