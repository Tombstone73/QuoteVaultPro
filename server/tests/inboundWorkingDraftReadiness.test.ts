import { describe, expect, test } from '@jest/globals';
import { inboundOrderReviewDraftPayloadSchema } from '@shared/inboundOrdersApi';
import { inboundDecisionResolvedByCurrentDraft, validateInboundProductConfiguration, validateInboundReviewDraft, type InboundProductConfiguration } from '@shared/inboundOrderReadiness';
import { inboundArtworkSizeReview, inboundPdfFileIdentity } from '@shared/inboundPdfSizeAnalysis';

const configuration: InboundProductConfiguration = { productId: 'active-product', productName: 'Synthetic area print',
  requiresEnteredDimensions: true, fixedDimensions: null, activeTreeVersionId: 'active-tree', treeJson: null,
  requiredOptions: [], suggestedSelections: { schemaVersion: 2, selected: {} }, suggestions: [] };
function draft() {
  return inboundOrderReviewDraftPayloadSchema.parse({ reviewedCustomerJson: { selectedCustomerId: 'customer' }, reviewedOrderJson: {},
    reviewedArtworkJson: { status: 'to_follow' }, reviewedLineItemsJson: [{ selectedProductId: 'active-product', quantity: 125,
      width: 2, height: 2, dimensionsUnit: 'in', pbv2TreeVersionId: 'active-tree',
      pricingReviewJson: { priceOverrideMode: 'override_total_after_margin', priceOverrideValueCents: 16500, priceOverrideSource: 'staff' } }],
    missingDecisionsJson: ['product', 'quantity', 'dimensions'].map(field => ({ field: `lineItems.0.${field}`, label: `${field} missing`, reason: 'Historical AI observation', severity: 'blocking' })) });
}
describe('canonical working-draft readiness', () => {
  test('sender ambiguity requires deliberate confirmation and historical contact observations clear from the current draft', () => {
    const current = draft();
    current.reviewedCustomerJson.senderMatch = { email: 'qa@example.invalid', status: 'ambiguous', candidates: [] };
    expect(validateInboundReviewDraft(current).join(' ')).toContain('multiple customer/contact relationships');
    current.reviewedCustomerJson.selectedCustomerSource = 'staff_selected';
    current.reviewedCustomerJson.selectedContactId = 'confirmed-contact';
    current.missingDecisionsJson = [{ field: 'customer.contact', label: 'Contact missing', reason: 'Historical AI finding', severity: 'blocking', status: 'still_blocking', resolutionNote: null }];
    expect(validateInboundReviewDraft(current)).toEqual([]);
  });
  test('three stickers corrected by staff clear historical field aliases, due date and shipping', () => {
    const current = draft();
    current.reviewedLineItemsJson[0].quantity = 3;
    current.reviewedOrderJson.dueDate = '2026-11-09';
    current.reviewedOrderJson.shipMethod = 'UPS Ground';
    current.missingDecisionsJson = ['product', 'line_items[0].finished_dimensions', 'quantity_confirmation', 'order.due_date', 'shipping_method'].map(field => ({
      field, label: `${field} missing`, reason: 'Historical AI observation', severity: 'blocking', status: 'still_blocking', resolutionNote: null,
    }));
    expect(current.missingDecisionsJson.map(decision => inboundDecisionResolvedByCurrentDraft(current, decision))).toEqual([true, true, true, true, true]);
    expect(validateInboundReviewDraft(current)).toEqual([]);
  });
  test('global findings require every line; indexed aliases cannot resolve a different line', () => {
    const current = draft();
    current.reviewedLineItemsJson.push({ ...structuredClone(current.reviewedLineItemsJson[0]), quantity: null, width: null, selectedProductId: null });
    const decision = (field: string) => ({ field, label: 'Missing field', reason: 'Historical observation' });
    for (const field of ['quantity_confirmation', 'product', 'finished_dimensions', 'reviewedLineItemsJson[1].quantity', 'line_items[1].product']) {
      expect(inboundDecisionResolvedByCurrentDraft(current, decision(field))).toBe(false);
    }
    expect(inboundDecisionResolvedByCurrentDraft(current, decision('line_items[0].quantity_confirmation'))).toBe(true);
    expect(inboundDecisionResolvedByCurrentDraft(current, { ...decision('custom.business_decision'), label: 'Confirm quantity discount' })).toBe(false);
    expect(validateInboundReviewDraft({ ...current, missingDecisionsJson: [{ ...decision('lineItems.0.options.special_finishing'), label: 'Choose unsupported finishing', severity: 'blocking', status: 'still_blocking', resolutionNote: null }] }).join(' ')).toContain('Choose unsupported finishing');
    expect(inboundDecisionResolvedByCurrentDraft(current, decision('order.due_date'))).toBe(false);
    expect(inboundDecisionResolvedByCurrentDraft(current, decision('shipping_method'))).toBe(false);
    current.reviewedOrderJson.fulfillmentType = 'pickup';
    expect(inboundDecisionResolvedByCurrentDraft(current, decision('shipping_method'))).toBe(true);
  });
  test('active PBV2 configuration clears fixed-size findings and owns required-options validation', () => {
    const current = draft(); const line = current.reviewedLineItemsJson[0]; line.width = null; line.height = null;
    const fixed = { ...configuration, requiresEnteredDimensions: false, fixedDimensions: { widthIn: 24, heightIn: 18, unit: 'in' as const } };
    const decision = { field: 'line_items[0].finished_dimensions', label: 'Missing size', reason: 'Historical observation' };
    expect(inboundDecisionResolvedByCurrentDraft(current, decision, [fixed])).toBe(true);
    expect(inboundDecisionResolvedByCurrentDraft(current, decision, [configuration])).toBe(false);
    const options = { ...decision, field: 'line_items[0].required_options' };
    expect(inboundDecisionResolvedByCurrentDraft(current, options)).toBe(false);
    expect(inboundDecisionResolvedByCurrentDraft(current, options, [fixed])).toBe(true);
    expect(inboundDecisionResolvedByCurrentDraft(current, options, [{ ...fixed, activeTreeVersionId: 'new-tree' }])).toBe(false);
    const conflict = { ...decision, reason: 'PO and email source documents disagree' };
    expect(inboundDecisionResolvedByCurrentDraft(current, conflict, [fixed])).toBe(false);
  });
  test('current product, quantity and finished dimensions supersede historical observations without erasing history', () => {
    const current = draft(); const history = structuredClone(current.missingDecisionsJson);
    expect(validateInboundReviewDraft(current)).toEqual([]);
    expect(validateInboundProductConfiguration(current.reviewedLineItemsJson[0], configuration, 0)).toEqual([]);
    expect(current.missingDecisionsJson).toEqual(history);
    current.reviewedLineItemsJson[0].selectedProductId = null;
    expect(validateInboundReviewDraft(current).join(' ')).toContain('select a product');
    current.reviewedLineItemsJson[0].quantity = null;
    expect(validateInboundReviewDraft(current).join(' ')).toContain('quantity is required');
  });
  test('invalid finished size, stale trees and unavailable catalog products remain actionable; fixed products derive their size', () => {
    const line = draft().reviewedLineItemsJson[0]; line.width = null;
    expect(validateInboundProductConfiguration(line, configuration, 0).join(' ')).toContain('width and height');
    expect(validateInboundProductConfiguration(line, null, 0).join(' ')).toContain('active product');
    expect(validateInboundProductConfiguration(line, { ...configuration, activeTreeVersionId: 'new-tree' }, 0).join(' ')).toContain('options changed');
    expect(validateInboundProductConfiguration(line, { ...configuration, requiresEnteredDimensions: false, fixedDimensions: { widthIn: 24, heightIn: 18, unit: 'in' } }, 0)).toEqual([]);
  });
  test('actual source conflicts and unrelated required decisions remain blocking after staff field correction', () => {
    const current = draft();
    const conflict = { field: 'evidence.reconciliation', label: 'Conflicting PO evidence', reason: 'Source documents disagree', severity: 'blocking' as const, status: 'still_blocking' as const, resolutionNote: null };
    current.missingDecisionsJson.push(conflict);
    expect(inboundDecisionResolvedByCurrentDraft(current, conflict)).toBe(false);
    expect(validateInboundReviewDraft(current).join(' ')).toContain('Conflicting PO evidence');
    const pdfObservation = { ...conflict, field: 'evidence.dimensions', label: 'PDF page size differs from finished size', reason: 'PDF artwork has bleed' };
    current.missingDecisionsJson = [pdfObservation];
    expect(validateInboundReviewDraft(current)).toEqual([]);
    current.reviewedLineItemsJson[0].width = null;
    expect(validateInboundProductConfiguration(current.reviewedLineItemsJson[0], configuration, 0).join(' ')).toContain('width and height');
  });
  test.each([[2.25, 2, 2, 2, true], [25, 37, 24, 36, true], [2, 2, 2, 2, false]])('PDF %s × %s and finished %s × %s are nonblocking metadata', (pdfWidth, pdfHeight, widthIn, heightIn, discrepancy) => {
    const file = { id: 'file', fileRecordId: 'record', checksum: 'checksum', sizeBytes: 20, status: 'available', sourceFilename: 'art.pdf', metadataJson: {} };
    file.metadataJson = { pdfSizeAnalysis: { status: 'succeeded', fileIdentity: inboundPdfFileIdentity(file), uniformPageSize: true,
      effectiveWidthInches: pdfWidth, effectiveHeightInches: pdfHeight } };
    expect(inboundArtworkSizeReview(file, { widthIn, heightIn })).toMatchObject({ discrepancy, blocking: false,
      pdfDimensions: { widthIn: pdfWidth, heightIn: pdfHeight }, finishedDimensions: { widthIn, heightIn } });
    expect(inboundArtworkSizeReview({ ...file, checksum: 'changed' }, { widthIn, heightIn })).toBeNull();
    expect(inboundArtworkSizeReview({ ...file, status: 'quarantined' }, { widthIn, heightIn })).toBeNull();
  });
});
