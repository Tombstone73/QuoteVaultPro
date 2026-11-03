// Synthetic UI harness only: every API request is intercepted; persistence is localStorage.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider, useTheme } from '@/hooks/useTheme';
import { queryClient } from '@/lib/queryClient';
import { TooltipProvider } from '@/components/ui/tooltip';
import EnhancedCustomerView from '@/features/customers/EnhancedCustomerView';
import '../../client/src/index.css';

const initial = {
  id: 'customer-ui-fixture', companyName: 'Sample Print Partners', customerType: 'business', status: 'active',
  email: 'office@example.test', phone: '(555) 010-1000', website: 'example.test',
  billingStreet1: '123 Example Avenue', billingStreet2: 'Suite 4', billingCity: 'Indianapolis', billingState: 'IN', billingPostalCode: '46201', billingCountry: 'US',
  shippingStreet1: '123 Example Avenue', shippingStreet2: 'Suite 4', shippingCity: 'Indianapolis', shippingState: 'IN', shippingPostalCode: '46201', shippingCountry: 'US',
  pricingTier: 'wholesale', defaultDiscountPercent: '5.00', defaultMarkupPercent: '10', defaultMarginPercent: null, productVisibilityMode: 'linked-only',
  creditLimit: '5000.00', creditLimitConfigured: true, creditLimitConfiguredAt: '2026-01-01', availableCredit: '4500.00', currentBalance: '500.00', outstandingAr: '500.00', pendingBilling: '120.00', creditExposure: '620.00', openWork: '1400.00', paymentTerms: 'net_30',
  isTaxExempt: true, taxExemptReason: 'Resale certificate', taxExemptCertificateRef: 'Certificate TEST-001', taxId: 'TEST-TAX-001', taxRateOverride: '0.07', alwaysRequireProof: true, blindShipping: true,
  notes: 'Call before delivery. Keep company instructions.', localCompanyFolderPath: '\\\\example-server\\production\\Sample Print',
  contacts: [
    { id: 'contact-primary', firstName: 'Robin', lastName: 'Review', title: 'Purchasing Manager', email: 'robin@example.test', phone: '(555) 010-1010', isPrimary: true, isBilling: true },
    { id: 'contact-buyer', firstName: 'Casey', lastName: 'Buyer', title: 'Office Coordinator', email: 'casey@example.test', phone: '(555) 010-1020', isPrimary: false, isBilling: false },
    { id: 'contact-pending', firstName: 'Sam', lastName: 'Invite', title: 'Billing', email: 'sam@example.test', phone: '(555) 010-1030', isPrimary: false, isBilling: true },
    { id: 'contact-suspended', firstName: 'Lee', lastName: 'Paused', title: 'Sales', email: 'lee@example.test', phone: null, isPrimary: false, isBilling: false },
  ],
  quotes: [], creditTransactions: [], createdAt: '2026-01-01', updatedAt: '2026-01-01',
};
let saved = JSON.parse(localStorage.getItem('customer-detail-fixture') || 'null') || initial;
let access = [
  { id: 'access-primary', contactId: 'contact-primary', email: 'robin@example.test', status: 'ACTIVE', createdAt: '2026-01-01', lastLoginAt: '2026-10-01' },
  { id: 'access-pending', contactId: 'contact-pending', email: 'sam@example.test', status: 'PENDING_INVITE', createdAt: '2026-01-01', inviteSentAt: '2026-10-01' },
  { id: 'access-suspended', contactId: 'contact-suspended', email: 'lee@example.test', status: 'SUSPENDED', createdAt: '2026-01-01' },
];
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const operations: Array<{ path: string; method: string; body: unknown }> = [];
Object.assign(window, { fixtureOperations: operations });
window.fetch = async (input, init) => {
  const url = new URL(String(input), window.location.origin), path = url.pathname;
  const method = init?.method || 'GET';
  if (method !== 'GET') operations.push({ path, method, body: init?.body ? JSON.parse(String(init.body)) : null });
  if (path === '/api/auth/session') return json({ authenticated: true, user: { id: 'synthetic-staff', role: 'admin', isAdmin: true } });
  if (path === '/api/me/orgs') return json({ success: true, data: { lastActiveOrgId: 'fixture-org', orgs: [{ id: 'fixture-org', name: 'Synthetic', role: 'admin' }] } });
  if (path === '/api/local-bridge/admin/destinations') return json({ data: { localPath: '\\\\example-server\\art\\Sample Print' } });
  if (path.endsWith('/account-credit')) return json({ availableCents: 2500 });
  if (path.endsWith('/activity')) return json({ openOrderCount: 3, overdueInvoiceCount: 0, lastOrderDate: "2026-10-30", lastPaymentDate: "2026-10-29" });
  if (path.endsWith('/portal-access') && method === 'GET') return json({ success: true, data: access });
  if (path.startsWith('/api/customer-portal-access/') && method === 'POST') {
    const [, , , id, action] = path.split('/');
    access = access.map(row => row.id === id ? { ...row, status: action === 'suspend' ? 'SUSPENDED' : action === 'activate' ? 'ACTIVE' : ['disable', 'cancel-invite'].includes(action) ? 'DISABLED' : row.status } : row);
    return json({ success: true });
  }
  if (path.endsWith('/portal-access') && method === 'POST') {
    const contactId = path.split('/')[5];
    const contact = saved.contacts.find((row: { id: string }) => row.id === contactId);
    access.push({ id: `access-${contactId}`, contactId, email: contact.email, status: 'PENDING_INVITE', createdAt: '2026-01-01', inviteSentAt: '2026-10-01' });
    return json({ success: true });
  }
  if (path === '/api/customers') return json([saved]);
  if (path === `/api/customers/${saved.id}`) {
    if (method === 'PATCH') { saved = { ...saved, ...JSON.parse(String(init?.body)) }; localStorage.setItem('customer-detail-fixture', JSON.stringify(saved)); return json(saved); }
    return json({ ...saved, notes: [{ id: 'history-note', subject: 'Call log', content: 'Synthetic saved note history', createdAt: '2026-01-01', noteType: 'general' }] });
  }
  if (path === '/api/invoices') return json({ data: [], pagination: { page: 1, pageSize: 50, totalCount: 0, totalPages: 1 }, summary: {} });
  if (path === '/api/orders') return json([]);
  return json({ success: true, data: {} });
};
declare global { interface Window { fixtureRefreshPortal: () => Promise<void>; } }
window.fixtureRefreshPortal = () => queryClient.invalidateQueries({ queryKey: [`/api/customers/${initial.id}/portal-access`] });
function Fixture() {
  const { theme, setTheme } = useTheme();
  return <><div className="flex items-center justify-between border-b px-4 py-2 text-sm"><span>Synthetic customer · mocked API and storage</span><button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>Switch theme</button></div><EnhancedCustomerView customerId={initial.id} /></>;
}
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={queryClient}><BrowserRouter><ThemeProvider><TooltipProvider><Fixture /></TooltipProvider></ThemeProvider></BrowserRouter></QueryClientProvider>);
