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
import EmailSettings from '@/pages/settings/email';
import OrderNewRoute from '@/pages/order-new';
import { WorkspaceHarness } from '../local-workspace-isolation/WorkspaceHarness';
import { SingleEditorWorkspace } from '@/contexts/WorkspaceContext';
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
let linkedEvidenceFixture = new URLSearchParams(location.search).has('linked-evidence');
const statusPanelFixture = new URLSearchParams(location.search).has('status-panels');
const senderTrustFixture = new URLSearchParams(location.search).has('sender-trust');
let fixtureSenderTrusted = sessionStorage.getItem('synthetic-sender-trusted') === 'true';
let trustNeedsReview = false; let trustParseCalls = 0;
const manualFallbackFixture = new URLSearchParams(location.search).has('manual-fallback');
const poParseFixture = new URLSearchParams(location.search).has('po-parse');
let poParseMode='hang';let poParseCalls=0;let holdPoBackground=false;let resolveLatePo:((response:Response)=>void)|null=null;
const artworkBypassFixture = new URLSearchParams(location.search).has('artwork-bypass');
let gmailRetryAttempts = 0;
let gmailFixtureCount = Number(new URLSearchParams(location.search).get('gmail-status') ?? 0);
let gmailFixtureFailureCount = gmailFixtureCount > 1 ? 2 : 0;
let gmailFixtureGate = 'global_pause';
let gmailFixturePermission = true;
let gmailFixtureOptIn = sessionStorage.getItem('synthetic-gmail-opt-in') !== 'false';
const fixtureMailbox = () => ({id:'qa-mailbox', provider:'gmail', name:'Synthetic Gmail', emailAddress:'qa@example.invalid', enabled:true, isDefault:true,
  acknowledgementPermission:gmailFixturePermission ? 'available' : 'reconnect_required', lastPulledAt:null,lastPullStatus:null,lastPullError:null,createdAt:now,updatedAt:now,
  settings:{gmailAcknowledgementEnabled:gmailFixtureOptIn,lookbackDays:14,maxMessages:50,gmailQuery:null,labelIds:[]}});
const fixtureRollout = () => ({enabled:!gmailFixtureGate,organizationId:'fixture',reason:gmailFixtureGate || null,
  message:gmailFixtureGate === 'global_pause' ? 'Gmail writes are paused by the global worker safety lock. Mailbox settings cannot override it.' : gmailFixtureGate === 'worker_pause' ? 'Gmail acknowledgement worker is disabled.' : gmailFixtureGate ? 'This tenant is not enrolled in the operational rollout.' : 'Gmail acknowledgement is operationally enabled for this tenant.'});
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
if (artworkBypassFixture) {
  files = []; parsed = true;
  const previous = sessionStorage.getItem('synthetic-inbound-conversion');
  if (!previous && sessionStorage.getItem('synthetic-inbound-draft')) savedReviewDraft = JSON.parse(sessionStorage.getItem('synthetic-inbound-draft')!);
  if (previous) { const stored = JSON.parse(previous); converted = true; inboundConversionPayload = stored; savedReviewDraft = { ...stored, inboundOrderRecordId: recordId, snapshotId: 'persisted-fixture', snapshotVersion: 2 }; }
}
if (poParseFixture) {
  parsed=true;
  files=[{...files[0],id:'synthetic-po',fileRecordId:'synthetic-po-file',sourceFilename:'PO-123.pdf',role:'email_attachment',mimeType:'application/pdf',status:'available',metadataJson:{attachmentState:'available'}}];
  const stored=sessionStorage.getItem('synthetic-po-draft');if(stored)savedReviewDraft=JSON.parse(stored);
}
if (manualFallbackFixture) {
  parsed = false;
  files = ['PO.pdf', 'artwork.pdf', 'reference.pdf'].map((name, index) => ({ ...files[0], id: `manual-file-${index}`, fileRecordId: `manual-canonical-${index}`,
    sourceFilename: name, role: index === 0 ? 'po' : index === 1 ? 'artwork' : 'reference', mimeType: 'application/pdf', status: 'available', metadataJson: { attachmentState: 'available' } }));
  const stored = sessionStorage.getItem('synthetic-manual-draft'); if (stored) savedReviewDraft = JSON.parse(stored);
}
if (senderTrustFixture) {
  parsed = true;
  files = [{ ...files[0], id: 'trust-art', sourceFilename: 'art.pdf', role: 'email_attachment', mimeType: 'application/pdf', status: 'uploaded', fileRecordId: null,
    providerAttachmentId: 'synthetic-trust-art', metadataJson: { attachmentState: 'pending_trust', attachmentSafetyReason: 'Sender approval is required for download.' } }];
  const storedFiles = sessionStorage.getItem('synthetic-trust-files'); if (storedFiles) files = JSON.parse(storedFiles);
  const stored = sessionStorage.getItem('synthetic-trust-draft'); if (stored) savedReviewDraft = JSON.parse(stored);
}
const entryIds = ['a'.repeat(64), 'b'.repeat(64)];
const archiveSha256 = 'c'.repeat(64);
let imported = 0;
const record = () => ({ id: recordId, organizationId: 'fixture', sourceType: 'email', sourceMessageId: 'synthetic-message',
  senderTrustStatus: senderTrustFixture ? fixtureSenderTrusted ? 'trusted_sender' : 'untrusted' : undefined,
  attachmentDownloadPolicy: senderTrustFixture ? !fixtureSenderTrusted || files.some(file => !file.fileRecordId) ? 'pending_trust' : 'auto_download_allowed' : undefined,
  status: converted ? 'submitted' : 'needs_review', reviewOutcome: converted ? 'order_created' : null,
  createdOrderId: converted || linkedEvidenceFixture ? 'qa-order-1' : null, linkedOrderNumber: converted ? 'QA-1' : null, createdQuoteId: null, matchedCustomerId: customerId,
  parsedAt: parsed ? now : null, receivedAt: now, createdAt: now, updatedAt: now, rejectedAt: null,
  rawPayloadJson: { subject: (readinessFixture || threeStickerFixture) ? 'Three stickers' : '20 double-sided yard signs by Monday evening', bodyText: artworkBypassFixture ? 'Please make 20 double-sided yard signs. Artwork will follow.' : (readinessFixture || threeStickerFixture)
    ? 'Please make three stickers. Artwork and PO are in Archive.zip.' : 'Please make 20 double-sided yard signs by Monday evening. Artwork and PO are in Archive.zip.',
    sender: { name: 'Synthetic buyer', email: 'qa-buyer@example.invalid' } },
  normalizedPayloadJson: { ...(linkedEvidenceFixture ? {unresolvedEvidenceFingerprint: `fixture-evidence-${revision}`} : {}), evidenceFingerprint: `fixture-evidence-${revision}`, importIncomplete: senderTrustFixture ? files.some(file => !file.fileRecordId) : !manualFallbackFixture && !artworkBypassFixture && !files[0].metadataJson.inboundArchiveResolution },
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
  evidenceReviewRequired: creationRecoveryFixture || trustNeedsReview, hasNewerParse: false, validationErrors: [],
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
const detail = () => ({ linkedOrder: converted ? { id: 'qa-order-1', orderNumber: 'QA-1', prepressLineItemId: 'qa-line-1' } : null, record: record(), source: null, lineItems: [], files, warnings: [], decisionFlags: [], events: [],
  latestParseAttempt: parsed ? { id: 'fixture-parse-1', status: 'success', createdAt: now } : null, latestReviewSnapshot: senderTrustFixture || poParseFixture || savedReviewDraft ? {id:'fixture-review-1',snapshotType:'approval'} : null });
const success = (data: unknown) => new Response(JSON.stringify({ success: true, data }), { status: 200, headers: { 'Content-Type': 'application/json' } });
const failure = (message: string, status = 409) => new Response(JSON.stringify({ success: false, message }), { status, headers: { 'Content-Type': 'application/json' } });
const originalFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.origin);
  const path = url.pathname;
  const method = init?.method?.toUpperCase() ?? 'GET';
  const payload = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
  if (!path.startsWith('/api/')) return originalFetch(input, init);
  const raw = (data:unknown) => new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
  if (path === '/api/organization/preferences') return raw({inboundEmail:{...defaultInboundEmailIntakeSettings,inboundEmailIntakeEnabled:true,inboundEmailPullPaused:true}});
  if (path === '/api/inbound-orders/email/mailboxes') return success({mailboxes:[fixtureMailbox()]});
  if (path === '/api/inbound-orders/email/mailboxes/qa-mailbox' && method === 'PATCH') {
    gmailFixtureOptIn=payload.settings.gmailAcknowledgementEnabled;
    sessionStorage.setItem('synthetic-gmail-opt-in',String(gmailFixtureOptIn));return success(fixtureMailbox());
  }
  if (path === '/api/inbound-orders/gmail-acknowledgements/overview') return raw({rollout:fixtureRollout(),mailboxes:[{mailboxId:'qa-mailbox',pendingCount:gmailFixtureCount,failedCount:gmailFixtureFailureCount,lastSucceededAt:now,lastError:gmailFixtureFailureCount ? 'Reconnect the same Gmail account, then retry.' : null}]});
  if (path === '/api/inbound-orders/email/pull-diagnostics') return success({organizationId:'fixture',enabledMailboxCount:1,ignoreRuleCount:0,mailboxes:[],activeIgnoreRules:[],ruleConflicts:[],recentCreatedInboundRecords:[],recentInboundFiles:[],recentPullMessageDiagnostics:[],recentFailedMessageDiagnostics:[],recentGmailFailedMessages:[],recentGmailIgnoredMessages:[],recentGmailListedMessages:[],recentGmailProcessedMessages:[],recentGmailSkippedMessages:[],subjectSearch:null});
  if(poParseFixture && path === `/api/inbound-orders/${recordId}/parse` && method === 'POST'){
    poParseCalls++;
    if(poParseMode==='hang')return new Promise(resolve=>{resolveLatePo=resolve;});
    if(poParseMode==='provider_error')return failure('AI parsing service unavailable. Source evidence and staff edits are retained. Retry Parse.',422);
    if(poParseMode==='no_text')return failure('PDF contains no extractable text. Scanned PDFs require external OCR or manual entry; no PO details were inferred.',422);
    if(poParseMode==='retrieval_error')return failure('Unable to retrieve PO attachment. Review its download and availability, then Retry Parse.',422);
    if(poParseMode==='conflict')return failure('Source evidence changed during parsing. Staff edits are retained; parse current evidence and deliberately reconcile.',409);
    if(poParseMode==='success_hold_refresh')holdPoBackground=true;
    return success({record:record(),draft:parsedDraft,latestAttempt:{id:'po-parse-new',status:'success',createdAt:now},reviewDraft:{...reviewDraft(),hasNewerParse:true}});
  }
  if(poParseFixture && holdPoBackground && (path === `/api/inbound-orders/${recordId}` || path === '/api/inbound-orders'))return new Promise(()=>{});
  if((manualFallbackFixture || senderTrustFixture) && path === `/api/inbound-orders/${recordId}/review-draft/manual` && method === 'POST') {
    if (payload.expectedEvidenceFingerprint !== `fixture-evidence-${revision}` || (payload.action !== 'initialize' && payload.expectedSnapshotId !== savedReviewDraft?.snapshotId)) return failure('Source evidence or saved draft changed. Your edits are retained.');
    const next = (savedReviewDraft?.snapshotVersion ?? 0) + 1;
    savedReviewDraft = savedReviewDraft ?? { ...structuredClone(originalReviewDraft), reviewedLineItemsJson: [], reviewedCustomerJson: { ...originalReviewDraft.reviewedCustomerJson, selectedCustomerId: null }, sourceParseAttemptId: null };
    savedReviewDraft = { ...savedReviewDraft, snapshotId: `fixture-manual-${next}`, snapshotVersion: next, evidenceReviewRequired: false, hasNewerParse: false };
    sessionStorage.setItem('synthetic-manual-draft', JSON.stringify(savedReviewDraft));
    return success(savedReviewDraft);
  }
  if(senderTrustFixture && path === `/api/inbound-orders/${recordId}/trust-action` && method === 'POST') {
    fixtureSenderTrusted = true; sessionStorage.setItem('synthetic-sender-trusted', 'true');
    let downloaded = 0;
    if(payload.action === 'trust_sender_and_download') {
      files = files.map(file => { if(file.fileRecordId) return file; downloaded++; return { ...file, fileRecordId: 'synthetic-trusted-canonical-art', status: 'available', metadataJson: { ...file.metadataJson, attachmentState: 'downloaded' } }; });
      if(downloaded) { revision++; trustNeedsReview = true; if(savedReviewDraft) savedReviewDraft = { ...savedReviewDraft, evidenceReviewRequired: true }; }
      sessionStorage.setItem('synthetic-trust-files', JSON.stringify(files));
    }
    return success({ result: { trustRuleType: 'sender_email_exact', trustRuleValue: 'qa-buyer@example.invalid', attempted: downloaded, downloaded, metadataOnly: 0, blocked: 0, failed: [] }, inbound: detail() });
  }
  if(senderTrustFixture && path === `/api/inbound-orders/${recordId}/files/classification/bulk` && method === 'POST') {
    files = files.map(file => payload.fileIds.includes(file.id) && file.status === 'available' ? { ...file, role: payload.classification === 'ARTWORK' ? 'artwork' : file.role,
      metadataJson: { ...file.metadataJson, attachmentClassification: { classification: payload.classification, confidence: 100, source: 'manual_override', reasons: ['Synthetic staff review'] } } } : file);
    revision++; trustNeedsReview = true; if(savedReviewDraft) savedReviewDraft = { ...savedReviewDraft, evidenceReviewRequired: true };
    sessionStorage.setItem('synthetic-trust-files', JSON.stringify(files)); return success({ files, warnings: [], errors: [] });
  }
  if(senderTrustFixture && path === `/api/inbound-orders/${recordId}/parse` && method === 'POST') trustParseCalls++;
  if(manualFallbackFixture && path === `/api/inbound-orders/${recordId}/parse` && method === 'POST') {
    if(poParseMode !== 'success') return success({ record: record(), draft: null, latestAttempt: { id: 'synthetic-invalid', status: 'failed', errors: [{ code: 'response_validation_failed', message: 'AI response could not be validated as an inbound order draft. Retry Parse or start manual entry.' }] } });
    parsed = true; return success({ record: record(), draft: parsedDraft, latestAttempt: { id: 'synthetic-retry', status: 'success' }, reviewDraft: { ...reviewDraft(), hasNewerParse: true } });
  }
  if(poParseFixture && path === `/api/inbound-orders/${recordId}/files/classification/bulk` && method==='POST'){
    files=files.map(file=>({...file,role:'po',metadataJson:{...file.metadataJson,attachmentClassification:{classification:'PO',confidence:100,source:'manual_override',reasons:['Staff selected PO']}}}));revision++;
    return success({files,errors:[],warnings:[]});
  }
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
  if (path === '/api/inbound-orders/gmail-acknowledgements/synthetic-ack/retry') { gmailRetryAttempts++; return success({ queued: true }); }
  if (path === '/api/inbound-orders/gmail-acknowledgements' && gmailFixtureCount) return raw({enabled:false,rollout:fixtureRollout(),counts:{pending:gmailFixtureCount,failed:gmailFixtureFailureCount},jobs:Array.from({length:gmailFixtureCount+gmailFixtureFailureCount},(_,i)=>({id:`synthetic-${i}`,inboundRecordId:recordId,orderId:`qa-order-${i}`,orderNumber:`QA-${i+1}`,mailboxId:'qa-mailbox',status:i < gmailFixtureCount ? 'waiting' : 'failed',attempts:1,message:i < gmailFixtureCount ? 'Covered evidence retained.' : 'Provider temporarily unavailable. The existing Order is unchanged.',canRetry:i>=gmailFixtureCount}))});
  if (path === '/api/inbound-orders/gmail-acknowledgements') return new Response(JSON.stringify({ enabled: false, jobs: converted && artworkBypassFixture ? [{ id: 'synthetic-ack', inboundRecordId: recordId, orderId: 'qa-order-1', mailboxId: 'qa-mailbox', status: 'failed', attempts: 1, message: 'Gmail update pending. Order QA-1 is already created.', canRetry: true }] : [] }),
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
  if (path === '/api/inbound-orders' && method === 'GET') {
    const included = !converted || ['converted', 'all'].includes(url.searchParams.get('statusGroup') ?? '');
    return new Response(JSON.stringify({ success: true, data: included ? [record()] : [],
      summary: { needsReview: converted ? 0 : 1, active: converted ? 0 : 1, convertedSubmitted: converted ? 1 : 0 }, total: included ? 1 : 0 }),
      { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (path === `/api/inbound-orders/${recordId}` && method === 'GET') return success(detail());
  if (path === `/api/inbound-orders/${recordId}/draft-preview`) return success({ draft: parsed ? parsedDraft : null, latestAttempt: parsed ? { id: 'fixture-parse-1', status: 'success', createdAt: now } : null });
  if (path === `/api/inbound-orders/${recordId}/review-draft` && method === 'PUT') {
    draftSaveAttempts += 1;
    if (payload.expectedSnapshotId && payload.expectedSnapshotId !== reviewDraft().snapshotId) return failure('Saved draft changed. Your local edits are retained.', 409);
    if (draftSaveAttempts === 1 || failNextDraftSave) { failNextDraftSave = false; return failure('Synthetic first draft save failure'); }
    const next = reviewDraft().snapshotVersion + 1;
    savedReviewDraft = { ...reviewDraft(), ...payload, snapshotId: `fixture-review-${next}`, snapshotVersion: next };
    if (artworkBypassFixture) sessionStorage.setItem('synthetic-inbound-draft', JSON.stringify(savedReviewDraft));
    if (senderTrustFixture) sessionStorage.setItem('synthetic-trust-draft', JSON.stringify(savedReviewDraft));
    if (manualFallbackFixture) sessionStorage.setItem('synthetic-manual-draft', JSON.stringify(savedReviewDraft));
    if (poParseFixture) sessionStorage.setItem('synthetic-po-draft', JSON.stringify(savedReviewDraft));
    return success(savedReviewDraft);
  }
  if (path === `/api/inbound-orders/${recordId}/review-draft`) return parsed || savedReviewDraft ? success(reviewDraft()) : failure('No draft', 404);
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
  if (path === '/api/inbound-orders/product-search') return success([{ id: productId, name: 'Yard Signs 24x18', category: 'Signs', pricingMode: 'quantity', pbv2ActiveTreeVersionId: 'fixture-tree-1' }, { id: dimensionProductId, name: 'Coroplast Custom', category: 'Signs', pricingMode: 'area', pbv2ActiveTreeVersionId: 'fixture-tree-2' }].filter(product => !manualFallbackFixture || product.name.toLowerCase().includes((url.searchParams.get('search') ?? '').toLowerCase())));
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
    if ((!senderTrustFixture && !manualFallbackFixture && !artworkBypassFixture && !files[0].metadataJson.inboundArchiveResolution) || (senderTrustFixture ? payload.reviewedArtworkJson?.status !== 'supplied' : payload.reviewedArtworkJson?.status !== 'to_follow') || payload.reviewedLineItemsJson?.[0]?.selectedProductId !== productId) return failure('Incomplete review');
    inboundConversionPayload = payload;
    converted = true;
    if (artworkBypassFixture) sessionStorage.setItem('synthetic-inbound-conversion', JSON.stringify(payload));
    (window as any).__fixtureCreatedOrders = ((window as any).__fixtureCreatedOrders ?? 0) + 1;
    return success({ orderId: 'qa-order-1', orderNumber: 'QA-1', order: { id: 'qa-order-1', orderNumber: 'QA-1', lineItems: [{ productId, quantity: payload.reviewedLineItemsJson[0].quantity,
      width: 24, height: 18, workflowState: 'ready_for_prepress', requiresPrepress: true }] }, inbound: detail(), alreadyConverted: false });
  }
  return success([]);
};
(window as any).__fixtureTrustState = () => ({ trusted: fixtureSenderTrusted, files, parseCalls: trustParseCalls });
(window as any).__fixtureTrustRefresh = () => queryClient.invalidateQueries({ queryKey: ['/api/inbound-orders'] });
(window as any).__fixtureState = () => ({ imported, converted, files: files.length, savedReviewDraft, directOrderPayload, inboundConversionPayload, draftSaveAttempts, directOrderAttempts, lastInboundPricingInput, creationAttempts, reconciliationAttempts, gmailRetryAttempts });
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
(window as any).__fixtureGmail = async (count:number,gate='global_pause',permission=true) => {
  gmailFixtureCount=count;gmailFixtureGate=gate;gmailFixturePermission=permission;
  await queryClient.invalidateQueries({queryKey:['/api/inbound-orders/gmail-acknowledgements']});
  await queryClient.invalidateQueries({queryKey:['/api/inbound-orders/gmail-acknowledgements/overview']});
  await queryClient.invalidateQueries({queryKey:['/api/inbound-orders/email/mailboxes']});
};
(window as any).__fixtureLinkedEvidence = async () => {
  linkedEvidenceFixture = true; revision++;
  await queryClient.invalidateQueries({queryKey:['/api/inbound-orders']});
};
(window as any).__fixtureGmailPreference = () => gmailFixtureOptIn;
(window as any).__fixtureManualSourceChange = async () => {
  revision++;
  if (savedReviewDraft) savedReviewDraft = { ...savedReviewDraft, evidenceReviewRequired: true };
  await queryClient.invalidateQueries({ queryKey: ['/api/inbound-orders', recordId] });
};
(window as any).__fixturePO = (mode:string) => {poParseMode=mode;};
(window as any).__fixturePOState = () => ({calls:poParseCalls});
(window as any).__fixturePOResume = async () => {
  holdPoBackground=false;
  await queryClient.cancelQueries({queryKey:['/api/inbound-orders']});
  await queryClient.invalidateQueries({queryKey:['/api/inbound-orders']});
};
(window as any).__fixturePOLate = () => resolveLatePo?.(success({record:record(),draft:parsedDraft,latestAttempt:{id:'late-ignored',status:'success'},reviewDraft:reviewDraft()}));
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
    <ThemeControls /><div className="h-[calc(100vh-32px)]">{new URLSearchParams(location.search).has('workspace-isolation') ? <WorkspaceHarness/> : location.pathname === '/settings/email' ? <EmailSettings /> : location.pathname === '/orders/new' ? <SingleEditorWorkspace><OrderNewRoute /></SingleEditorWorkspace> : <InboundOrdersPage />}</div>
  </TooltipProvider></NavigationGuardProvider></BrowserRouter></QueryClientProvider></ThemeProvider>,
);
