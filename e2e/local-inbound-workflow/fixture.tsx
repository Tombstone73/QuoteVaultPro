import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider, useTheme } from '@/hooks/useTheme';
import { queryClient } from '@/lib/queryClient';
import { TooltipProvider } from '@/components/ui/tooltip';
import { NavigationGuardProvider } from '@/contexts/NavigationGuardContext';
import { defaultInboundEmailIntakeSettings } from '@shared/inboundEmailIntakeSettings';
import InboundOrdersPage from '@/pages/inbound-orders';
import '../../client/src/index.css';

const recordId = '00000000-0000-4000-8000-000000000001';
const archiveId = '00000000-0000-4000-8000-000000000002';
const productId = '00000000-0000-4000-8000-000000000003';
const customerId = '00000000-0000-4000-8000-000000000004';
const now = '2026-10-31T12:00:00.000Z';
let revision = 1;
let parsed = false;
let converted = false;
let files: any[] = [{ id: archiveId, organizationId: 'fixture', inboundRecordId: recordId,
  fileRecordId: 'fixture-zip-record', sourceFilename: 'Archive.zip', role: 'email_attachment', mimeType: 'application/zip',
  sizeBytes: 2048, status: 'quarantined', checksum: 'synthetic-archive', metadataJson: { attachmentState: 'scan_pending' },
  providerMessageId: 'synthetic-message', providerAttachmentId: 'synthetic-archive', createdAt: now, updatedAt: now }];
const entryIds = ['a'.repeat(64), 'b'.repeat(64)];
const archiveSha256 = 'c'.repeat(64);
let imported = 0;
const record = () => ({ id: recordId, organizationId: 'fixture', sourceType: 'email', sourceMessageId: 'synthetic-message',
  status: converted ? 'submitted' : 'needs_review', reviewOutcome: converted ? 'order_created' : null,
  createdOrderId: converted ? 'qa-order-1' : null, createdQuoteId: null, matchedCustomerId: customerId,
  parsedAt: parsed ? now : null, receivedAt: now, createdAt: now, updatedAt: now, rejectedAt: null,
  rawPayloadJson: { subject: '20 double-sided yard signs by Monday evening', bodyText: 'Please make 20 double-sided yard signs by Monday evening. Artwork and PO are in Archive.zip.',
    sender: { name: 'Synthetic buyer', email: 'qa-buyer@example.invalid' } },
  normalizedPayloadJson: { evidenceFingerprint: `fixture-evidence-${revision}`, importIncomplete: !files[0].metadataJson.inboundArchiveResolution },
});
const parsedDraft: any = { customer: { sourceName: 'Synthetic buyer', sourceEmail: 'qa-buyer@example.invalid', companyName: 'Synthetic buyer',
    candidateCustomerIds: [customerId], candidateContactIds: [], customerCandidates: [{ id: customerId, label: 'Synthetic buyer', confidence: 99, reason: 'Exact customer match', metadata: {} }],
    contactCandidates: [], confidence: 99, warnings: [] },
  order: { requestedDueDate: '2026-11-02', requestedPickup: true, poNumber: 'PO-123', confidence: 99, warnings: [] },
  lineItems: [{ sourceText: '20 double-sided yard signs', productName: 'Yard Signs', candidateProductIds: [productId],
    productCandidates: [{ id: productId, label: 'Yard Signs 24x18', confidence: 98, reason: 'Unique active catalog match', metadata: {} }],
    quantity: 20, width: null, height: null, dimensionsUnit: null, materialText: null, optionTexts: ['double-sided'], finishingTexts: [],
    artworkRefs: [], confidence: 98, warnings: [] }], artwork: [], globalWarnings: [], missingDecisions: [],
  evidence: { items: [], conflicts: [], reconciliation: null } };
const reviewDraft = () => ({ snapshotId: 'fixture-review-1', snapshotVersion: 1, status: 'draft', updatedAt: now,
  evidenceReviewRequired: false, hasNewerParse: false, validationErrors: [],
  reviewedCustomerJson: { sourceName: 'Synthetic buyer', sourceEmail: 'qa-buyer@example.invalid', companyName: 'Synthetic buyer',
    selectedCustomerId: customerId, selectedCustomerSource: 'crm_match', selectedContactId: null, unresolvedCustomer: false, unresolvedContact: false },
  reviewedOrderJson: { intent: 'order', poNumber: 'PO-123', dueDate: '2026-11-02', priority: 'normal', shipMethod: null,
    fulfillmentType: 'pickup', internalNotes: null, customerNotes: null },
  reviewedLineItemsJson: [{ sourceLineItemId: null, sourceText: '20 double-sided yard signs', productName: 'Yard Signs 24x18',
    selectedProductId: productId, selectedProductSource: 'catalog_match', interpretedProductId: productId, interpretedProductConfidence: 98,
    productUnresolved: false, quantity: 20, quantitySource: 'source_evidence', width: null, height: null, dimensionsUnit: null,
    dimensionsSource: null, materialText: null, materialSource: null, printSpecs: [], printSpecsSource: null, optionTexts: ['double-sided'],
    optionTextsSource: 'source_evidence', finishingTexts: [], finishingTextsSource: null,
    optionSelectionsJson: { schemaVersion: 2, selected: { sides: { value: 'double', origin: 'SOURCE_EVIDENCE', evidence: 'double-sided' } } },
    pbv2TreeVersionId: 'fixture-tree-1', pbv2OptionSuggestions: [],
    pricingReviewJson: { status: 'matched', sourceEvidence: [], alternatePricingNotes: [], calculatedLineTotalCents: 16500, systemLineTotalCents: 16500,
      priceOverrideMode: null, priceOverrideValueCents: null, priceOverrideSource: null, acknowledged: true,
      resolution: 'system_price', effectiveLineTotalCents: 16500 },
    artworkLinks: [], artworkQuantityMode: 'same_quantity_each', notes: null }],
  reviewedArtworkJson: { status: 'missing', refs: [], unassignedAttachments: [], notes: null },
  missingDecisionsJson: [], warningsJson: [], unsupportedRequestsJson: [], customerIntelligenceJson: null, reviewNotes: null });
const detail = () => ({ record: record(), source: null, lineItems: [], files, warnings: [], decisionFlags: [], events: [],
  latestParseAttempt: parsed ? { id: 'fixture-parse-1', status: 'success', createdAt: now } : null, latestReviewSnapshot: null });
const success = (data: unknown) => new Response(JSON.stringify({ success: true, data }), { status: 200, headers: { 'Content-Type': 'application/json' } });
const failure = (message: string, status = 409) => new Response(JSON.stringify({ success: false, message }), { status, headers: { 'Content-Type': 'application/json' } });
const originalFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.origin);
  const path = url.pathname;
  const method = init?.method?.toUpperCase() ?? 'GET';
  const payload = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
  if (!path.startsWith('/api/')) return originalFetch(input, init);
  if (path === '/api/inbound-orders/gmail-acknowledgements') return new Response(JSON.stringify({ enabled: false, jobs: [] }),
    { status: 200, headers: { 'Content-Type': 'application/json' } });
  if (path === '/api/inbound-orders/email-imports') return success({ enabled: false, jobs: [] });
  if (path === '/api/inbound-orders/email-settings') return success({ ...defaultInboundEmailIntakeSettings, inboundEmailIntakeEnabled: true, inboundEmailPullPaused: true });
  if (path === '/api/inbound-orders' && method === 'GET') return new Response(JSON.stringify({ success: true, data: converted ? [] : [record()],
    summary: { needsReview: converted ? 0 : 1, active: converted ? 0 : 1, convertedSubmitted: converted ? 1 : 0 }, total: converted ? 0 : 1 }),
    { status: 200, headers: { 'Content-Type': 'application/json' } });
  if (path === `/api/inbound-orders/${recordId}` && method === 'GET') return success(detail());
  if (path === `/api/inbound-orders/${recordId}/draft-preview`) return success({ draft: parsed ? parsedDraft : null, latestAttempt: parsed ? { id: 'fixture-parse-1', status: 'success', createdAt: now } : null });
  if (path === `/api/inbound-orders/${recordId}/review-draft`) return parsed ? success(reviewDraft()) : failure('No draft', 404);
  if (path === `/api/inbound-orders/${recordId}/parse` && method === 'POST') { parsed = true; return success({ record: record(), draft: parsedDraft,
    latestAttempt: { id: 'fixture-parse-1', status: 'success', createdAt: now }, reviewDraft: reviewDraft() }); }
  if (path === `/api/inbound-orders/${recordId}/archives/${archiveId}/inspect` && method === 'POST') return success({
    archiveIdentity: 'fixture-archive-identity', archiveSha256, evidenceFingerprint: `fixture-evidence-${revision}`,
    entries: [{ id: entryIds[0], filename: 'PO-123.pdf', uncompressedBytes: 100, supported: true, reason: null, suggestedRole: 'po' },
      { id: entryIds[1], filename: 'front.pdf', uncompressedBytes: 100, supported: true, reason: null, suggestedRole: 'artwork' },
      { id: 'd'.repeat(64), filename: 'script.exe', uncompressedBytes: 20, supported: false, reason: 'File type is not supported for inbound import.', suggestedRole: 'reference' }],
  });
  if (path === `/api/inbound-orders/${recordId}/archives/${archiveId}/import` && method === 'POST') {
    if (payload.expectedEvidenceFingerprint !== `fixture-evidence-${revision}` || payload.archiveSha256 !== archiveSha256) return failure('Evidence changed');
    const added = payload.entries.filter((entry: any) => !files.some((file) => file.metadataJson?.archiveEntryId === entry.id));
    for (const entry of added) { const index = entryIds.indexOf(entry.id); if (index < 0) return failure('Unsupported entry');
      files.push({ id: `00000000-0000-4000-8000-00000000000${index + 5}`, organizationId: 'fixture', inboundRecordId: recordId,
        fileRecordId: `fixture-extracted-${index}`, sourceFilename: index === 0 ? 'PO-123.pdf' : 'front.pdf', role: entry.role,
        mimeType: 'application/pdf', sizeBytes: 100, status: 'available', checksum: `fixture-${index}`,
        metadataJson: { extractedFromArchiveFileId: archiveId, extractedFromArchiveIdentity: 'fixture-archive-identity', archiveEntryId: entry.id },
        createdAt: now, updatedAt: now }); }
    if (added.length) revision += 1;
    imported += added.length;
    return success({ files: files.slice(1), importedCount: added.length, skippedCount: payload.entries.length - added.length,
      evidenceFingerprint: `fixture-evidence-${revision}` });
  }
  if (path === `/api/inbound-orders/${recordId}/archives/${archiveId}/resolve` && method === 'POST') {
    if (payload.expectedEvidenceFingerprint !== `fixture-evidence-${revision}` || payload.fileIds.length !== 2 || !payload.contentsReviewed) return failure('Review current evidence');
    files[0] = { ...files[0], metadataJson: { ...files[0].metadataJson, inboundArchiveResolution: { fileIds: payload.fileIds, contentsReviewed: true } } };
    revision += 1;
    return success({ evidenceFingerprint: `fixture-evidence-${revision}`, remainingUnresolvedFileIds: [] });
  }
  if (path === '/api/inbound-orders/product-search') return success([{ id: productId, name: 'Yard Signs 24x18', category: 'Signs', pricingMode: 'quantity', pbv2ActiveTreeVersionId: 'fixture-tree-1' }]);
  if (path === `/api/inbound-orders/product-options/${productId}`) return success({ productId, productName: 'Yard Signs 24x18',
    activeTreeVersionId: 'fixture-tree-1', requiresEnteredDimensions: false, fixedDimensions: { widthIn: 24, heightIn: 18 },
    treeJson: { schemaVersion: 2, rootNodeIds: ['sides'], nodes: { sides: { id: 'sides', kind: 'question', label: 'Sides', input: { type: 'select', required: true, selectionKey: 'sides' },
      choices: [{ id: 'single', value: 'single', label: 'Single sided' }, { id: 'double', value: 'double', label: 'Double sided' }] } } }, requiredOptions: [] });
  if (path === `/api/inbound-orders/${recordId}/create-order` && method === 'POST') {
    if (!files[0].metadataJson.inboundArchiveResolution || payload.reviewedArtworkJson?.status !== 'to_follow' || payload.reviewedLineItemsJson?.[0]?.selectedProductId !== productId) return failure('Incomplete review');
    converted = true;
    (window as any).__fixtureCreatedOrders = ((window as any).__fixtureCreatedOrders ?? 0) + 1;
    return success({ orderId: 'qa-order-1', orderNumber: 'QA-1', order: { id: 'qa-order-1', orderNumber: 'QA-1', lineItems: [{ productId, quantity: 20,
      width: 24, height: 18, workflowState: 'ready_for_prepress', requiresPrepress: true }] }, inbound: detail(), alreadyConverted: false });
  }
  return success([]);
};
(window as any).__fixtureState = () => ({ imported, converted, files: files.length });
(window as any).__fixtureQueries = () => queryClient.getQueryCache().getAll().map((query) => ({
  key: query.queryKey, status: query.state.status, data: query.state.data, error: String(query.state.error ?? ''),
}));

function ThemeControls() {
  const { theme, setTheme } = useTheme();
  return <div className="flex items-center gap-2 border-b border-border bg-background px-3 py-1 text-xs text-foreground">
    Synthetic inbound fixture: <button type="button" onClick={() => setTheme('light')}>Light</button>
    <button type="button" onClick={() => setTheme('dark')}>Dark</button><span>Theme: {theme}</span>
  </div>;
}

createRoot(document.getElementById('root')!).render(
  <ThemeProvider><QueryClientProvider client={queryClient}><BrowserRouter><NavigationGuardProvider><TooltipProvider>
    <ThemeControls /><div className="h-[calc(100vh-32px)]"><InboundOrdersPage /></div>
  </TooltipProvider></NavigationGuardProvider></BrowserRouter></QueryClientProvider></ThemeProvider>,
);
