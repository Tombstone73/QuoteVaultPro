import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ProofEarlyReleaseAction, ProofEarlyReleaseNotice } from './ProofEarlyRelease';
import { apiFetch } from '@/lib/queryClient';
import type { ProofingReadModel } from '@shared/proofing';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
jest.mock('@/lib/queryClient', () => ({ apiFetch: jest.fn() }));
const toast = jest.fn();
jest.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }));
let root: Root, host: HTMLDivElement, client: QueryClient;
const onReleased = jest.fn(async () => undefined);
const authorization = { id: 'release', proofVersionId: 'proof1', actorUserId: 'admin', reason: 'Customer requested expedition', authorizedAt: '2026-10-28T09:10:00.000Z', artworkFingerprint: 'a'.repeat(64), proofFileId: 'proof-file' };
const detail = { requiresProofApproval: true, approvedProofVersionId: null, proofGate: { allowed: false }, earlyReleaseReview: {
  expectedUpdatedAt: '2026-10-28T09:00:00.000Z', expectedOwnerJobId: 'owner', revision: { proofVersionId: 'proof1', proofFileId: 'file1', status: 'awaiting_response', artworkFingerprint: 'a'.repeat(64) },
} } as unknown as ProofingReadModel;
beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(globalThis.crypto, 'randomUUID', { configurable: true, value: () => '11111111-1111-4111-8111-111111111111' });
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
});
afterEach(() => { act(() => root.unmount()); document.body.innerHTML = ''; });
function render(value = detail, canAuthorize = true) { act(() => root.render(<QueryClientProvider client={client}><ProofEarlyReleaseAction lineItemId="line" detail={value} canAuthorize={canAuthorize} onReleased={onReleased} /></QueryClientProvider>)); }
function button(label: string) { return Array.from(document.querySelectorAll('button')).find(b => b.textContent === label)!; }
function open() { act(() => button('Release to Production Without Approval').click()); }
function enterReason() { act(() => { const input = document.querySelector('textarea')!; Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, 'Customer requested expedition'); input.dispatchEvent(new Event('input', { bubbles: true })); }); }
const response = (data: any, ok = true) => ({ ok, json: async () => ({ success: ok, data, error: ok ? undefined : 'Proof or artwork changed' }) });
test('confirmation explains risk and requires a reason before submitting', () => {
  render(); open();
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('materials and labor already used may require reprinting');
  expect(button('Confirm Early Release').disabled).toBe(true);
  expect(apiFetch).not.toHaveBeenCalled();
  enterReason(); expect(button('Confirm Early Release').disabled).toBe(false);
  act(() => button('Cancel').click()); expect(apiFetch).not.toHaveBeenCalled();
});
test('authorized confirmation sends the reviewed identity and waits for durable readback', async () => {
  (apiFetch as jest.Mock).mockResolvedValueOnce(response({ authorization })).mockResolvedValueOnce(response({ ...detail, proofGate: { earlyRelease: authorization } }));
  render(); open(); enterReason();
  await act(async () => button('Confirm Early Release').click());
  const body = JSON.parse((apiFetch as jest.Mock).mock.calls[0][1].body);
  expect(body).toMatchObject({ reason: 'Customer requested expedition', confirmed: true, proofVersionId: 'proof1', artworkFingerprint: 'a'.repeat(64), expectedOwnerJobId: 'owner' });
  expect((apiFetch as jest.Mock).mock.calls[1]).toEqual(['/api/proofing/line-item/line', { credentials: 'include', cache: 'no-store' }]);
  expect(onReleased).toHaveBeenCalledTimes(1); expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Released before customer approval' }));
});
test('mismatched readback produces no success indication', async () => {
  (apiFetch as jest.Mock).mockResolvedValueOnce(response({ authorization })).mockResolvedValueOnce(response(detail));
  render(); open(); enterReason(); await act(async () => button('Confirm Early Release').click());
  expect(onReleased).not.toHaveBeenCalled(); expect(toast).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'Released before customer approval' }));
  expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Early release not confirmed' }));
});
test('a stale confirmation retains the originally reviewed revision', async () => {
  (apiFetch as jest.Mock).mockResolvedValueOnce(response(null, false));
  render(); open(); enterReason();
  render({ ...detail, earlyReleaseReview: { ...detail.earlyReleaseReview!, revision: { ...detail.earlyReleaseReview!.revision!, proofVersionId: 'proof2', artworkFingerprint: 'b'.repeat(64) } } });
  await act(async () => button('Confirm Early Release').click());
  expect(JSON.parse((apiFetch as jest.Mock).mock.calls[0][1].body).proofVersionId).toBe('proof1');
  expect(onReleased).not.toHaveBeenCalled();
});
test('staff without authorization do not receive the release action', () => { render(detail, false); expect(button('Release to Production Without Approval')).toBeUndefined(); });
test('a recorded early release is explicitly pending rather than approved', () => {
  act(() => root.render(<ProofEarlyReleaseNotice detail={{ ...detail, earlyReleaseHistory: [authorization], proofGate: { allowed: true, approved: false, requiresProofApproval: true, earlyRelease: authorization } }} />));
  expect(host.textContent).toContain('Customer approval remains pending'); expect(host.textContent).toContain(authorization.reason); expect(host.textContent).toContain('admin');
});
