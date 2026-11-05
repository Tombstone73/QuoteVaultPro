import { describe, expect, test } from '@jest/globals';
import { inboundOrderParsedDraftSchema, inboundOrderReviewDraftPayloadSchema } from '@shared/inboundOrdersApi';
import { applyInboundReviewProjection, projectInboundReviewIssues, resolveInboundReviewIssue } from '@shared/inboundReviewIssues';
import { inboundReviewDraftProblems, validateInboundProductConfiguration } from '@shared/inboundOrderReadiness';
import { reconcileInboundEvidence, extractPurchaseOrderFields } from '../services/inboundOrders/InboundOrderEvidenceService';

const parsed = (quantity = 3) => inboundOrderParsedDraftSchema.parse({ customer: { companyName: 'Elite Printing Inc.' },
  order: { intent: 'quote' }, lineItems: [{ productName: 'Vehicle trailer vinyl', quantity, width: 24, height: 18, dimensionsUnit: 'in' }],
  evidence: { reconciliation: { quantity: { value: quantity, status: 'confirmed', sources: [{ sourceType: 'EMAIL_BODY', label: 'Email', sourceText: `Quantity: ${quantity}` }] }, product: {}, dimensions: {}, material: {}, dueDate: {}, rushStatus: {}, artworkStatus: {}, pricingStatus: {} } } });
function draft() { return inboundOrderReviewDraftPayloadSchema.parse({
  reviewedCustomerJson: { selectedCustomerId: 'customer' }, reviewedOrderJson: { intent: 'quote' }, reviewedArtworkJson: { status: 'missing' },
  reviewedLineItemsJson: [{ selectedProductId: 'vinyl', quantity: 3, width: 24, height: 18, dimensionsUnit: 'in', pricingReviewJson: { systemPriceCents: 9000 } }],
  missingDecisionsJson: [{ field: 'lineItems.0.quantity', label: 'Review quantity', reason: 'Source documents disagree about quantity.', severity: 'blocking' }],
  warningsJson: [{ code: 'evidence_quantity_conflict', fieldPath: 'lineItems.0.quantity', message: 'Quantity evidence differs between sources.', severity: 'warning' }],
}); }
function resolve(current = draft(), source = parsed(5), action: 'confirm_current' | 'accept_source' | 'interpretation_incorrect' | 'dismiss' = 'confirm_current', reason: string | null = null, requireReason = false) {
  return resolveInboundReviewIssue({ draft: current, parsed: source, actorUserId: 'staff', evidenceFingerprint: 'evidence-v1', requireReason,
    action: { issueId: projectInboundReviewIssues(current,source)[0].id, action, reason }, now: '2026-11-05T15:00:00Z' });
}
describe('version-bound staff review of AI interpretations', () => {
  test('source and staff quantity 3 agree; stale AI disagreement no longer blocks readiness', () => {
    const source = parsed(3), current = draft();
    expect(projectInboundReviewIssues(current,source).every(issue => issue.status === 'resolved')).toBe(true);
    expect(inboundReviewDraftProblems(applyInboundReviewProjection(current,source),undefined,'quote')).toEqual([]);
    expect(current.missingDecisionsJson[0].status).toBe('still_blocking');
  });
  test('numeric source text 3.0 and numeric quantity 3 agree', () => {
    const source = parsed(); source.evidence.reconciliation!.quantity.value = '3.0';
    expect(projectInboundReviewIssues(draft(),source)[0].status).toBe('resolved');
  });
  test('artwork versions are not finished quantities', () => {
    const text = 'Please quote: Quantity 3. Finished size 24 x 18 inches. Vehicle trailer vinyl. Artwork has 2 versions.';
    const poSummary = extractPurchaseOrderFields({ text,sourceDocument:'Synthetic PO' });
    const source = { id:'email', type:'EMAIL_BODY', label:'Email', rawText:text, warnings:[], documentType:'purchase_order', poSummary };
    const result = reconcileInboundEvidence([source as never]);
    expect(result.quantity.value).toBe(3); expect(result.quantity.status).not.toBe('conflict'); expect(result.quantity.conflicts).toEqual([]);
  });
  test('staff can accept source 5 with original interpretation and actor/version history', () => {
    const result = resolve(draft(),parsed(5),'accept_source');
    expect(result.reviewedLineItemsJson[0].quantity).toBe(5);
    expect(result.reviewResolutionsJson?.[0]).toMatchObject({ originalInterpretation: 5, confirmedValue:5, actorUserId:'staff', evidenceFingerprint:'evidence-v1', reason:null });
    expect(result.reviewedLineItemsJson[0].quantitySource).toBe('staff_selected');
  });
  test.each(['confirm_current','interpretation_incorrect','dismiss'] as const)('%s records intentional source 5 / current 3 without changing source', action => {
    const source = parsed(5), result = resolve(draft(),source,action);
    expect(result.reviewedLineItemsJson[0].quantity).toBe(3); expect(source.lineItems[0].quantity).toBe(5);
    expect(projectInboundReviewIssues(result,source)[0].status).toBe('resolved');
    expect(result.reviewResolutionsJson?.[0].confirmedValue).toBe(3);
  });
  test('optional reason and organization-required reason are enforced only for new disagreement actions', () => {
    expect(resolve().reviewResolutionsJson?.[0].reason).toBeNull();
    expect(() => resolve(draft(),parsed(5),'confirm_current',null,true)).toThrow('reason required');
    expect(resolve(draft(),parsed(5),'confirm_current','Customer confirmed 3',true).reviewResolutionsJson?.[0].reason).toBe('Customer confirmed 3');
    expect(() => resolve(draft(),parsed(5),'accept_source',null,true)).not.toThrow();
    expect(projectInboundReviewIssues(resolve(),parsed(5))[0].status).toBe('resolved');
  });
  test('unrelated parse updates retain resolution, relevant field evidence reopens only that issue', () => {
    const result = resolve(); const updated = parsed(5); updated.order.requestedDueDate = '2026-11-10';
    expect(projectInboundReviewIssues(result,updated)[0].status).toBe('resolved');
    expect(projectInboundReviewIssues(result,parsed(7))[0].status).toBe('open');
    expect(result.reviewedLineItemsJson[0].quantity).toBe(3);
  });
  test('unrelated decision insertion does not invalidate field-bound confirmations', () => {
    const result = resolve(); result.missingDecisionsJson.unshift({ field:'order.jobLabel',label:'Confirm job',reason:'Not specified',severity:'warning',status:'still_blocking',resolutionNote:null });
    expect(projectInboundReviewIssues(result,parsed(5)).find(issue => issue.field === 'lineItems.0.quantity')?.status).toBe('resolved');
  });
  test('real file, ownership, stale-evidence, and canonical pricing gates cannot be dismissed', () => {
    const current = draft(); current.warningsJson = []; current.missingDecisionsJson = [{ field:'lineItems.0.artwork',label:'Quarantined artwork',reason:'File is quarantined',severity:'blocking',status:'still_blocking',resolutionNote:null }];
    expect(projectInboundReviewIssues(current,parsed())).toEqual([]);
    expect(() => resolveInboundReviewIssue({ draft:current,parsed:parsed(), actorUserId:'staff',evidenceFingerprint:'v1',requireReason:false,action:{ issueId:'invented',action:'dismiss' } })).toThrow('cannot be dismissed');
    const accepted = applyInboundReviewProjection(resolve(),parsed(5)); accepted.reviewedLineItemsJson[0].pricingReviewJson = null;
    expect(inboundReviewDraftProblems(accepted,undefined,'quote').some(problem => problem.target === 'pricing')).toBe(true);
  });
  test('Quote preparation does not inherit Order-only artwork requirements', () => {
    const current = draft(); current.missingDecisionsJson = [];
    expect(inboundReviewDraftProblems(current,undefined,'quote')).toEqual([]);
    expect(inboundReviewDraftProblems(current,undefined,'order').some(problem => problem.target === 'artwork')).toBe(true);
    current.reviewedLineItemsJson[0].quantity = null;
    expect(inboundReviewDraftProblems(current,undefined,'quote').some(problem => problem.target === 'quantity')).toBe(true);
  });
  test('product and finished-size corrections are reviewable without disabling canonical product validation',()=>{
    const current=draft();current.warningsJson=[];
    current.missingDecisionsJson=[{field:'lineItems.0.dimensions',label:'Confirm finished size',reason:'Source dimensions differ from interpreted size.',severity:'blocking',status:'still_blocking',resolutionNote:null}];
    const result=resolve(current,parsed(),'confirm_current');
    expect(result.reviewedLineItemsJson[0].dimensionsSource).toBe('staff_selected');expect(result.reviewResolutionsJson?.[0].confirmedValue).toEqual({width:24,height:18,unit:'in'});
    current.reviewedLineItemsJson[0].width=null;
    const bypassed=resolve(current,parsed(),'dismiss');
    expect(validateInboundProductConfiguration(bypassed.reviewedLineItemsJson[0],{productId:'vinyl',requiresEnteredDimensions:true,activeTreeVersionId:null,treeJson:null,productName:'Vinyl',fixedDimensions:null,requiredOptions:[],suggestedSelections:{schemaVersion:2,selected:{}},suggestions:[]},0).join(' ')).toContain('width and height');
    current.missingDecisionsJson=[{...current.missingDecisionsJson[0],field:'lineItems.0.productName',label:'Confirm selected product',reason:'Source product differs from interpreted product.'}];
    current.reviewedLineItemsJson[0].selectedProductId='different-active-product';
    const selected=resolve(current,parsed(),'confirm_current');expect(selected.reviewedLineItemsJson[0].selectedProductSource).toBe('staff_selected');expect(selected.reviewResolutionsJson?.[0].confirmedValue).toBe('different-active-product');
  });
  test('a later value change and a different line identity cannot reuse an earlier confirmation',()=>{
    const saved=applyInboundReviewProjection(resolve(),parsed(5));saved.reviewedLineItemsJson[0].quantity=4;
    expect(projectInboundReviewIssues(saved,parsed(5))[0].status).toBe('open');
    saved.reviewedLineItemsJson[0].quantity=3;saved.reviewedLineItemsJson[0].sourceText='Different customer specification';
    expect(projectInboundReviewIssues(saved,parsed(5))[0].status).toBe('open');
  });
  test('multiple lines keep separate confirmations and never compare every line with a global quantity',()=>{
    const current=draft();current.warningsJson=[];current.reviewedLineItemsJson.push({...structuredClone(current.reviewedLineItemsJson[0]),sourceText:'Second item',quantity:7});
    current.missingDecisionsJson.push({...current.missingDecisionsJson[0],field:'lineItems.1.quantity',label:'Second quantity'});
    const result=resolve(current,parsed(5));const issues=projectInboundReviewIssues(result,parsed(5));
    expect(issues.find(issue=>issue.lineIndex===0)?.status).toBe('resolved');expect(issues.find(issue=>issue.lineIndex===1)?.status).toBe('open');
    expect(result.reviewedLineItemsJson[1].quantity).toBe(7);
  });
  test('a deliberate global confirmation protects each covered line during later reconciliation',()=>{
    const current=draft();current.warningsJson=[];
    current.reviewedLineItemsJson.push({...structuredClone(current.reviewedLineItemsJson[0]),sourceText:'Second item',quantity:7,quantitySource:'ai_inferred'});
    current.missingDecisionsJson=[{...current.missingDecisionsJson[0],field:'quantity'}];
    const issue=projectInboundReviewIssues(current,parsed(5))[0];
    const saved=resolveInboundReviewIssue({draft:current,parsed:parsed(5),actorUserId:'staff',evidenceFingerprint:'v1',requireReason:false,action:{issueId:issue.id,action:'confirm_current'}});
    expect(saved.reviewedLineItemsJson.map(line=>line.quantitySource)).toEqual(['staff_selected','staff_selected']);
    expect(saved.reviewResolutionsJson?.[0].confirmedValue).toEqual([3,7]);
  });
});
