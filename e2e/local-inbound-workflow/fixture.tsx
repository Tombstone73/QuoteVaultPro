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
import OrderNewRoute from '@/pages/order-new';
import '../../client/src/index.css';

const recordId = '00000000-0000-4000-8000-000000000001';
const archiveId = '00000000-0000-4000-8000-000000000002';
const productId = '00000000-0000-4000-8000-000000000003';
const dimensionProductId = '00000000-0000-4000-8000-000000000007';
const customerId = '00000000-0000-4000-8000-000000000004';
const contactId = '00000000-0000-4000-8000-000000000008';
const alternativeCustomerId = '00000000-0000-4000-8000-000000000009';
const alternativeContactId = '00000000-0000-4000-8000-000000000010';
const senderMatchFixture = new URLSearchParams(location.search).get('sender-match');
const readinessFixture = new URLSearchParams(location.search).has('current-readiness');
const now = '2026-10-31T12:00:00.000Z';
const statusPanelFixture = new URLSearchParams(location.search).has('status-panels');
const creationRecoveryFixture = new URLSearchParams(location.search).has('creation-recovery');
let creationRace = false;
let failNextDraftSave = false;
let creationAttempts = 0;
let reconciliationAttempts = 0;
let parsedEvidenceRevision = 0;
let threeStickerFixture = false;
let revision = 1;
let parsed = false;
let converted = false;
let savedReviewDraft: any = null;
let directOrderPayload: any = null;
let inboundConversionPayload: any = null;
let draftSaveAttempts = 0;
let directOrderAttempts = 0;
let lastInboundPricingInput: any = null;
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
  rawPayloadJson: { subject: (readinessFixture || threeStickerFixture) ? 'Three stickers' : '20 double-sided yard signs by Monday evening', bodyText: (readinessFixture || threeStickerFixture)
    ? 'Please make three stickers. Artwork and PO are in Archive.zip.' : 'Please make 20 double-sided yard signs by Monday evening. Artwork and PO are in Archive.zip.',
    sender: { name: 'Synthetic buyer', email: 'qa-buyer@example.invalid' } },
  normalizedPayloadJson: { evidenceFingerprint: `fixture-evidence-${revision}`, importIncomplete: !files[0].metadataJson.inboundArchiveResolution },
});
const parsedDraft: any = { customer: { sourceName: 'Synthetic buyer', sourceEmail: 'qa-buyer@example.invalid', companyName: 'Synthetic buyer',
    candidateCustomerIds: [customerId], candidateContactIds: [], customerCandidates: [{ id: customerId, label: 'Synthetic buyer', confidence: 99, reason: 'Exact customer match', metadata: {} }],
    contactCandidates: [], confidence: 99, warnings: [] },
  order: { requestedDueDate: '2026-11-02', requestedPickup: true, poNumber: 'PO-123', confidence: 99, warnings: [] },
  lineItems: [{ sourceText: readinessFixture ? 'three stickers' : '20 double-sided yard signs', productName: 'Yard Signs', candidateProductIds: [productId],
    productCandidates: [{ id: productId, label: 'Yard Signs 24x18', confidence: 98, reason: 'Unique active catalog match', metadata: {} }],
    quantity: 20, width: null, height: null, dimensionsUnit: null, materialText: null, optionTexts: ['double-sided'], finishingTexts: [],
    artworkRefs: [], confidence: 98, warnings: [] }], artwork: [], globalWarnings: [], missingDecisions: [],
  evidence: { items: [], conflicts: [], reconciliation: null } };
const reviewDraft = (): any => savedReviewDraft ?? ({ inboundOrderRecordId: recordId, snapshotId: 'fixture-review-1', snapshotVersion: 1, status: 'draft', updatedAt: now,
  evidenceReviewRequired: creationRecoveryFixture, hasNewerParse: false, validationErrors: [],
  reviewedCustomerJson: { sourceName: 'Synthetic buyer', sourceEmail: 'qa-buyer@example.invalid', companyName: 'Synthetic buyer',
    selectedCustomerId: senderMatchFixture && senderMatchFixture !== 'exact' ? null : customerId, selectedCustomerSource: 'crm_match',
    selectedContactId: senderMatchFixture === 'exact' ? contactId : null, unresolvedCustomer: senderMatchFixture === 'ambiguous', unresolvedContact: false,
    senderMatch: !senderMatchFixture ? null : { email: 'qa-buyer@example.invalid', status: senderMatchFixture === 'exact' ? 'matched' : senderMatchFixture === 'ambiguous' ? 'ambiguous' : 'none',
      candidates: senderMatchFixture === 'unknown' ? [] : [{ customerId, customerName: 'Synthetic buyer', contactId, contactName: 'Synthetic Buyer' },
        ...(senderMatchFixture === 'ambiguous' ? [{ customerId: alternativeCustomerId, customerName: 'Alternative buyer', contactId: alternativeContactId, contactName: 'Alternative Contact' }] : [])] } },
  reviewedOrderJson: { intent: 'order', poNumber: 'PO-123', dueDate: '2026-11-02', priority: 'normal', shipMethod: null,
    fulfillmentType: 'pickup', internalNotes: null, customerNotes: null },
  reviewedLineItemsJson: [{ sourceLineItemId: null, sourceText: '20 double-sided yard signs', productName: 'Yard Signs 24x18',
    selectedProductId: productId, selectedProductSource: 'catalog_match', interpretedProductId: productId, interpretedProductConfidence: 98,
    productUnresolved: false, quantity: 20, quantitySource: 'source_evidence', width: null, height: null, dimensionsUnit: null,
    dimensionsSource: null, materialText: null, materialSource: null, printSpecs: [], printSpecsSource: null, optionTexts: ['double-sided'],
    optionTextsSource: 'source_evidence', finishingTexts: [], finishingTextsSource: null,
    optionSelectionsJson: { schemaVersion: 2, selected: { sides: { value: 'double', origin: 'SOURCE_EVIDENCE', evidence: 'double-sided' } } },
    pbv2TreeVersionId: 'fixture-tree-1', pbv2OptionSuggestions: [],
    pricingReviewJson: { status: 'matched', sourceEvidence: [], alternatePricingNotes: [], systemPriceCents: 16500, systemUnitPriceCents: 825,
      priceOverrideMode: null, priceOverrideValueCents: null, priceOverrideSource: null, acknowledged: true,
      resolution: 'system_price', effectiveTotalCents: 16500, effectiveUnitPriceCents: 825 },
    artworkLinks: [], artworkQuantityMode: 'same_quantity_each', notes: null }],
  reviewedArtworkJson: { status: 'missing', refs: [], unassignedAttachments: [], notes: null },
  missingDecisionsJson: [], warningsJson: [], unsupportedRequestsJson: [], customerIntelligenceJson: null, reviewNotes: null });
const originalReviewDraft = reviewDraft();
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
  if (path === '/api/auth/session') return new Response(JSON.stringify({ authenticated: true, user: { id: 'synthetic-staff', role: 'employee', email: 'staff@example.invalid', organizationId: 'fixture' } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  if (path === '/api/products' && method === 'GET') return new Response(JSON.stringify([
    { id: productId, name: 'Yard Signs 24x18', isActive: true, measurementMode: 'quantity_only', pricingMode: 'quantity', price: 8.25, pbv2ActiveTreeVersionId: 'fixture-tree-1', optionTreeJson: { schemaVersion: 2, rootNodeIds: [], nodes: {}, meta: { fixedDimensions: { widthIn: 24, heightIn: 18 } } } },
    { id: dimensionProductId, name: 'Coroplast Custom', isActive: true, measurementMode: 'area', pricingMode: 'area', price: 4, pbv2ActiveTreeVersionId: 'fixture-tree-2' },
  ]), { status: 200, headers: { 'Content-Type': 'application/json' } });
  if (path === '/api/organization/current') return new Response(JSON.stringify({ id: 'fixture' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  if (path === '/api/quotes/calculate' && method === 'POST') return new Response(JSON.stringify({ linePrice: payload.productId === productId ? 164.92 : 120, priceBreakdown: { basePrice: 164.92, total: 164.92 }, pbv2TreeVersionId: payload.productId === productId ? 'fixture-tree-1' : 'fixture-tree-2', pbv2SnapshotJson: { treeJson: { schemaVersion: 2, rootNodeIds: [], nodes: {}, meta: payload.productId === productId ? { fixedDimensions: { widthIn: 24, heightIn: 18 } } : { requiresDimensions: true } } } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  if (path === '/api/orders' && method === 'POST') { directOrderAttempts += 1; if (directOrderAttempts === 1) return failure('Synthetic first save failure'); directOrderPayload = payload; return success({ order: { id: 'qa-direct-order', orderNumber: 'QA-DIRECT-1' } }); }
  if (path === `/api/products/${productId}/pbv2/tree`) return success({ active: { id: 'fixture-tree-1', treeJson: { schemaVersion: 2, rootNodeIds: [], nodes: {}, meta: { fixedDimensions: { widthIn: 24, heightIn: 18 } } } } });
  if (path === `/api/products/${dimensionProductId}/pbv2/tree`) return success({ active: { id: 'fixture-tree-2', treeJson: { schemaVersion: 2, rootNodeIds: [], nodes: {}, meta: { requiresDimensions: true } } } });
  if (path === '/api/inbound-orders/gmail-acknowledgements') return new Response(JSON.stringify({ enabled: false, jobs: [] }),
    { status: 200, headers: { 'Content-Type': 'application/json' } });
  if (path === '/api/inbound-orders/email-imports') return success({ enabled: false, jobs: statusPanelFixture ? Array.from({ length: 30 }, (_, index) => ({
    id: `synthetic-import-${index}`, workKind: 'message', mailboxId: 'synthetic-mailbox', inboundRecordId: recordId,
    status: index < 5 ? 'needs_attention' : index < 7 ? 'failed' : 'complete', attempts: 1,
    nextAttemptAt: now, message: `Synthetic retained import ${index}`, errorCode: null, canRetry: index < 7,
  })) : [] });
  if (path === `/api/inbound-orders/${recordId}/processing` && statusPanelFixture) return success({ enabled: false, job: {
    id: 'synthetic-ai-job', status: 'needs_attention', attempts: 1, nextAttemptAt: now,
    errorCode: null, message: 'Synthetic draft requires review.', canRetry: false,
  } });
  if (path === '/api/inbound-orders/email-settings') return success({ ...defaultInboundEmailIntakeSettings, inboundEmailIntakeEnabled: true, inboundEmailPullPaused: true });
  if (path === '/api/customers' && method === 'GET') return success({ customers: [{ id: customerId, companyName: 'Synthetic buyer', contacts: [{ id: contactId, customerId, firstName: 'Synthetic', lastName: 'Buyer', isPrimary: true }] }], pagination: { page: 1, total: 1 } });
  if (path === `/api/customers/${customerId}` && method === 'GET') return new Response(JSON.stringify({ id: customerId, companyName: 'Synthetic buyer', contacts: [{ id: contactId, customerId, firstName: 'Synthetic', lastName: 'Buyer', isPrimary: true }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  if (path === '/api/contacts' && method === 'GET') return new Response(JSON.stringify({ contacts: [{ id: contactId, customerId, firstName: 'Synthetic', lastName: 'Buyer', email: 'qa-buyer@example.invalid', isPrimary: true }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  if (path === `/api/contacts/${contactId}` && method === 'GET') return new Response(JSON.stringify({ contact: { id: contactId, customerId, firstName: 'Synthetic', lastName: 'Buyer', email: 'qa-buyer@example.invalid' } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  if (path === `/api/customers/${alternativeCustomerId}` && method === 'GET') return new Response(JSON.stringify({ id: alternativeCustomerId, companyName: 'Alternative buyer', contacts: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  if (path === `/api/contacts/${alternativeContactId}` && method === 'GET') return new Response(JSON.stringify({ contact: { id: alternativeContactId, customerId: alternativeCustomerId, firstName: 'Alternative', lastName: 'Contact', email: 'qa-buyer@example.invalid' } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  if (path === '/api/inbound-orders' && method === 'GET') return new Response(JSON.stringify({ success: true, data: converted ? [] : [record()],
    summary: { needsReview: converted ? 0 : 1, active: converted ? 0 : 1, convertedSubmitted: converted ? 1 : 0 }, total: converted ? 0 : 1 }),
    { status: 200, headers: { 'Content-Type': 'application/json' } });
  if (path === `/api/inbound-orders/${recordId}` && method === 'GET') return success(detail());
  if (path === `/api/inbound-orders/${recordId}/draft-preview`) return success({ draft: parsed ? parsedDraft : null, latestAttempt: parsed ? { id: 'fixture-parse-1', status: 'success', createdAt: now } : null });
  if (path === `/api/inbound-orders/${recordId}/review-draft` && method === 'PUT') {
    draftSaveAttempts += 1;
    if (payload.expectedSnapshotId && payload.expectedSnapshotId !== reviewDraft().snapshotId) return failure('Saved draft changed. Your local edits are retained.', 409);
    if (draftSaveAttempts === 1 || failNextDraftSave) { failNextDraftSave = false; return failure('Synthetic first draft save failure'); }
    const next = reviewDraft().snapshotVersion + 1;
    savedReviewDraft = { ...reviewDraft(), ...payload, snapshotId: `fixture-review-${next}`, snapshotVersion: next };
    return success(savedReviewDraft);
  }
  if (path === `/api/inbound-orders/${recordId}/review-draft`) return parsed ? success(reviewDraft()) : failure('No draft', 404);
  if (path === `/api/inbound-orders/${recordId}/review-draft/refresh-from-latest-parse` && method === 'POST') {
    if (payload.expectedSnapshotId !== reviewDraft().snapshotId) return failure('Saved draft changed. Your local edits are retained.', 409);
    reconciliationAttempts++;
    if (creationRecoveryFixture && parsedEvidenceRevision !== revision) return failure('Latest parse does not cover current evidence. Parse again before refreshing.', 409);
    const next = reviewDraft().snapshotVersion + 1;
    savedReviewDraft = { ...reviewDraft(), snapshotId: `fixture-review-${next}`, snapshotVersion: next, hasNewerParse: false, evidenceReviewRequired: false };
    return success(savedReviewDraft);
  }
  if (path === `/api/inbound-orders/${recordId}/parse` && method === 'POST') { parsed = true; parsedEvidenceRevision = revision; return success({ record: record(), draft: parsedDraft,
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
  if (path === '/api/inbound-orders/product-search') return success([{ id: productId, name: 'Yard Signs 24x18', category: 'Signs', pricingMode: 'quantity', pbv2ActiveTreeVersionId: 'fixture-tree-1' }, { id: dimensionProductId, name: 'Coroplast Custom', category: 'Signs', pricingMode: 'area', pbv2ActiveTreeVersionId: 'fixture-tree-2' }]);
  if (path === `/api/inbound-orders/product-options/${dimensionProductId}`) return success({ productId: dimensionProductId, productName: 'Coroplast Custom', activeTreeVersionId: 'fixture-tree-2', requiresEnteredDimensions: true, fixedDimensions: null, treeJson: { schemaVersion: 2, rootNodeIds: [], nodes: {} }, requiredOptions: [], suggestedSelections: { schemaVersion: 2, selected: {} }, suggestions: [] });
  if (path === `/api/inbound-orders/product-options/${productId}`) return success({ productId, productName: 'Yard Signs 24x18',
    activeTreeVersionId: 'fixture-tree-1', requiresEnteredDimensions: false, fixedDimensions: { widthIn: 24, heightIn: 18 },
    treeJson: { schemaVersion: 2, rootNodeIds: ['sides'], nodes: { sides: { id: 'sides', kind: 'question', label: 'Sides', input: { type: 'select', required: true, selectionKey: 'sides' },
      choices: [{ id: 'single', value: 'single', label: 'Single sided' }, { id: 'double', value: 'double', label: 'Double sided' }] } } }, requiredOptions: [], suggestedSelections: { schemaVersion: 2, selected: {} }, suggestions: [] });
  if (path === '/api/inbound-orders/review-line-pricing' && method === 'POST') {
    lastInboundPricingInput = payload.lineItem;
    return success({ pricingReviewJson: { ...payload.lineItem.pricingReviewJson, status: 'matched', message: null, systemPriceCents: 16500, systemUnitPriceCents: Math.round(16500 / payload.lineItem.quantity), effectiveTotalCents: 16500, effectiveUnitPriceCents: Math.round(16500 / payload.lineItem.quantity) } });
  }
  if (path === `/api/inbound-orders/${recordId}/create-order` && method === 'POST') {
    creationAttempts++;
    if (converted) return success({ orderId: 'qa-order-1', orderNumber: 'QA-1', order: { id: 'qa-order-1', orderNumber: 'QA-1' }, inbound: detail(), alreadyConverted: true });
    if (creationRecoveryFixture && payload.expectedSnapshotId !== reviewDraft().snapshotId) return failure('Saved draft changed. Load the current saved draft before retrying.', 409);
    if (creationRace) { creationRace = false; revision++; }
    if (creationRecoveryFixture && (reviewDraft().evidenceReviewRequired || parsedEvidenceRevision !== revision)) {
      savedReviewDraft = { ...reviewDraft(), ...payload, snapshotId: `fixture-review-${reviewDraft().snapshotVersion + 1}`, snapshotVersion: reviewDraft().snapshotVersion + 1, evidenceReviewRequired: true };
      return new Response(JSON.stringify({ success: false, code: 'INBOUND_REVIEW_CONFLICT', message: 'Source evidence changed. Parse current evidence and deliberately refresh before approval.',
        errors: ['Source evidence changed. Parse current evidence and deliberately refresh before approval.'], reviewDraft: savedReviewDraft }), { status: 409, headers: { 'Content-Type': 'application/json' } });
    }
    if (!files[0].metadataJson.inboundArchiveResolution || payload.reviewedArtworkJson?.status !== 'to_follow' || payload.reviewedLineItemsJson?.[0]?.selectedProductId !== productId) return failure('Incomplete review');
    inboundConversionPayload = payload;
    converted = true;
    (window as any).__fixtureCreatedOrders = ((window as any).__fixtureCreatedOrders ?? 0) + 1;
    return success({ orderId: 'qa-order-1', orderNumber: 'QA-1', order: { id: 'qa-order-1', orderNumber: 'QA-1', lineItems: [{ productId, quantity: payload.reviewedLineItemsJson[0].quantity,
      width: 24, height: 18, workflowState: 'ready_for_prepress', requiresPrepress: true }] }, inbound: detail(), alreadyConverted: false });
  }
  return success([]);
};
(window as any).__fixtureState = () => ({ imported, converted, files: files.length, savedReviewDraft, directOrderPayload, inboundConversionPayload, draftSaveAttempts, directOrderAttempts, lastInboundPricingInput, creationAttempts, reconciliationAttempts });
(window as any).__fixtureEditorRepair = async (currentReadiness: boolean | "aliases" = false) => {
  const artwork = files.find(file => file.sourceFilename === 'front.pdf');
  artwork.metadataJson.pdfSizeAnalysis = { status: 'succeeded', fileIdentity: `${artwork.fileRecordId}:${artwork.checksum}:${artwork.sizeBytes}`,
    uniformPageSize: true, effectiveWidthInches: 2.25, effectiveHeightInches: 2, pages: [], pageCount: 1, units: 'in' };
  savedReviewDraft = { ...structuredClone(originalReviewDraft), snapshotId: "fixture-repair-2", snapshotVersion: 2 };
  Object.assign(savedReviewDraft.reviewedLineItemsJson[0], { selectedProductId: null, productName: 'AI suggested print', productUnresolved: false,
    quantity: null, width: null, height: null, pbv2TreeVersionId: null, optionSelectionsJson: null, pricingReviewJson: null, optionTexts: [] });
  savedReviewDraft.missingDecisionsJson = ['product', 'dimensions', 'quantity', 'artwork'].map(field => ({ field: `lineItems.0.${field}`,
    label: `AI reported missing ${field}`, reason: 'Historical parse observation', severity: 'blocking', status: 'still_blocking', resolutionNote: null }));
  if (currentReadiness && currentReadiness !== "aliases") {
    savedReviewDraft.reviewedLineItemsJson[0].sourceText = 'three stickers';
    savedReviewDraft.reviewedOrderJson = { ...savedReviewDraft.reviewedOrderJson, dueDate: null, shipMethod: null, fulfillmentType: 'unknown' };
    savedReviewDraft.missingDecisionsJson = [
      ['product', 'product'], ['reviewedLineItemsJson[0].finished_dimensions', 'dimensions'], ['quantity_confirmation', 'quantity'],
      ['artwork', 'artwork'], ['order.due_date', 'due date'], ['shipping_method', 'shipping method'],
    ].map(([field, label]) => ({ field, label: `AI reported missing ${label}`, reason: 'Historical parse observation', severity: 'blocking', status: 'still_blocking', resolutionNote: null }));
  }
  savedReviewDraft.validationErrors = ['Product not selected', 'Width and height missing', 'Quantity missing', 'Artwork not linked'];
  if (currentReadiness === "aliases") {
    threeStickerFixture = true;
    savedReviewDraft.reviewedLineItemsJson[0].sourceText = 'Please print three stickers';
    savedReviewDraft.missingDecisionsJson = ['productName', 'dimensions', 'quantity', 'artwork', 'options'].map(field => ({ field: `lineItems[0].${field}`,
      label: `AI reported missing ${field === 'productName' ? 'product' : field}`, reason: 'Historical parse observation', severity: 'blocking', status: 'still_blocking', resolutionNote: null }))
      .concat(['requestedDueDate', 'shippingMethod'].map(field => ({ field: `order.${field}`, label: `AI reported missing ${field}`, reason: 'Historical parse observation', severity: 'blocking', status: 'still_blocking', resolutionNote: null })));
    Object.assign(savedReviewDraft.reviewedOrderJson, { dueDate: null, shipMethod: null, fulfillmentType: 'unknown' });
  }

  await queryClient.invalidateQueries({ queryKey: ['/api/inbound-orders', recordId] });
};
(window as any).__fixtureCreationRace = () => { creationRace = true; };
(window as any).__fixtureFailNextDraftSave = () => { failNextDraftSave = true; };
(window as any).__fixtureQueries = () => queryClient.getQueryCache().getAll().map((query) => ({
  key: query.queryKey, status: query.state.status, data: query.state.data, error: String(query.state.error ?? ''),
}));
(window as any).__fixtureBackgroundRefresh = async () => {
  const next = reviewDraft().snapshotVersion + 1;
  savedReviewDraft = { ...reviewDraft(), snapshotId: `fixture-review-${next}`, snapshotVersion: next, hasNewerParse: true, updatedAt: new Date().toISOString() };
  await queryClient.invalidateQueries({ queryKey: ['/api/inbound-orders', recordId] });
};

function ThemeControls() {
  const { theme, setTheme } = useTheme();
  return <div className="flex items-center gap-2 border-b border-border bg-background px-3 py-1 text-xs text-foreground">
    Synthetic inbound fixture: <button type="button" onClick={() => setTheme('light')}>Light</button>
    <button type="button" onClick={() => setTheme('dark')}>Dark</button><span>Theme: {theme}</span>
  </div>;
}

createRoot(document.getElementById('root')!).render(
  <ThemeProvider><QueryClientProvider client={queryClient}><BrowserRouter><NavigationGuardProvider><TooltipProvider>
    <ThemeControls /><div className="h-[calc(100vh-32px)]">{location.pathname === '/orders/new' ? <OrderNewRoute /> : <InboundOrdersPage />}</div>
  </TooltipProvider></NavigationGuardProvider></BrowserRouter></QueryClientProvider></ThemeProvider>,
);
