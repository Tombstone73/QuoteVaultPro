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
