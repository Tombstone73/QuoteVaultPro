import { jest, beforeEach, afterEach, test, expect } from '@jest/globals';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PortalProfilePage from './profile';
import PortalFileSubmissionCard from '@/components/portal/PortalFileSubmissionCard';

const session = jest.fn();
const save = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const upload = jest.fn();
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const address = { street1: null, street2: null, city: null, state: null, postalCode: null, country: null };
const profile = { company: { name: 'Synthetic company', phone: '', email: '' }, billingAddress: address,
  shippingAddress: address, contact: null, latestPortalUpdate: null };
jest.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: jest.fn() }) }));
jest.mock('@/hooks/usePortal', () => ({
  usePortalSession: () => session(),
  usePortalProfile: () => ({ data: profile }),
  useUpdatePortalProfile: () => ({ mutateAsync: save, isPending: false }),
  usePortalFileSubmission: () => ({ mutateAsync: upload, isPending: false }),
  portalDashboardKeys: { all: ['dashboard'] }, portalProfileKeys: { all: ['profile'] },
  portalOrderKeys: { files: () => ['order-files'] }, portalQuoteKeys: { files: () => ['quote-files'] },
  PORTAL_FILE_SUBMISSION_ACCEPT_ATTRIBUTE: '.pdf', PORTAL_FILE_SUBMISSION_GUIDANCE: 'Files require review.',
}));

let host: HTMLDivElement;
let root: Root;
let queryClient: QueryClient;
beforeEach(() => {
  save.mockReset().mockResolvedValue({}); upload.mockReset();
  session.mockReturnValue({ data: { permissions: { canEditProfile: false, canUploadFiles: false } } });
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => { act(() => root.unmount()); host.remove(); queryClient.clear(); });
function render(element: React.ReactElement) { act(() => root.render(<QueryClientProvider client={queryClient}>{element}</QueryClientProvider>)); }

test('read-only profile shows the restriction and disables editing', () => {
  render(<PortalProfilePage />);
  expect(host.textContent).toContain('Company Admin access');
  expect(host.querySelector('fieldset')?.disabled).toBe(true);
  expect(Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('Save Profile'))?.disabled).toBe(true);
  expect(save).not.toHaveBeenCalled();
});

test('Company Admin retains canonical profile save', async () => {
  session.mockReturnValue({ data: { permissions: { canEditProfile: true } } });
  render(<PortalProfilePage />);
  expect(host.querySelector('fieldset')?.disabled).toBe(false);
  const button = Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('Save Profile'));
  await act(async () => button?.click());
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ company: { phone: null, email: null } }));
});

test('file controls fail closed until the session grants upload permission', () => {
  render(<PortalFileSubmissionCard entity="orders" entityId="synthetic-order" />);
  expect(host.querySelector('fieldset')?.disabled).toBe(true);
  expect(host.textContent).toContain('Buyer or Company Admin access');
  session.mockReturnValue({ data: { permissions: { canUploadFiles: true } } });
  render(<PortalFileSubmissionCard entity="orders" entityId="synthetic-order" />);
  expect(host.querySelector('fieldset')?.disabled).toBe(false);
  expect(upload).not.toHaveBeenCalled();
});
