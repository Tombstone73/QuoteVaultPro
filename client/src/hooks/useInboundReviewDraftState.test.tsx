import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { InboundOrderReviewDraftDto } from '@shared/inboundOrdersApi';
import { useInboundReviewDraftState, cloneInboundReviewDraft } from './useInboundReviewDraftState';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, container: HTMLDivElement, state: ReturnType<typeof useInboundReviewDraftState>;
function fixture(id = 'a', version = 1): InboundOrderReviewDraftDto {
  return { inboundOrderRecordId: id, snapshotId: `${id}-${version}`, snapshotVersion: version,
    reviewedCustomerJson: { selectedCustomerId: 'customer', selectedContactId: 'contact' },
    reviewedOrderJson: { poNumber: 'Original', intent: 'order', priority: 'normal' },
    reviewedLineItemsJson: [{ selectedProductId: 'product', quantity: 2, width: 12, height: 18,
      optionSelectionsJson: { selected: { sides: { value: 'single' } } }, pricingReviewJson: { effectiveTotalCents: 1000 }, artworkLinks: [{ fileId: 'source' }] }],
    reviewedArtworkJson: { status: 'to_follow' }, missingDecisionsJson: [], warningsJson: [], reviewNotes: null,
  } as unknown as InboundOrderReviewDraftDto;
}
function Harness({ id, server }: { id: string; server: InboundOrderReviewDraftDto | null }) { state = useInboundReviewDraftState(id, server); return null; }
function render(server = fixture(), id = server.inboundOrderRecordId) { act(() => root.render(<Harness id={id} server={server} />)); }
beforeEach(() => { container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); });

test('dirty customer, contact, product, dimensions, options, quantity and exact price survive newer background snapshots', () => {
  render();
  act(() => state.updateForm(current => ({ reviewedCustomerJson: { ...current.reviewedCustomerJson, selectedCustomerId: 'staff-customer', selectedContactId: 'staff-contact' },
    reviewedLineItemsJson: current.reviewedLineItemsJson.map(line => ({ ...line, selectedProductId: 'staff-product', quantity: 28, width: 24, height: 18,
      optionSelectionsJson: { schemaVersion: 2, selected: { sides: { value: 'double', origin: 'USER' } } },
      pricingReviewJson: { ...line.pricingReviewJson, priceOverrideValueCents: 16500 } })) })));
  const edited = state.form;
  render({ ...fixture('a', 2), hasNewerParse: true });
  expect(state.form).toEqual(edited); expect(state.dirty).toBe(true); expect(state.serverChanged).toBe(true);
  expect(state.expectedSnapshotId('a')).toBe('a-1');
  expect(state.form?.reviewedLineItemsJson[0].artworkLinks).toEqual(fixture().reviewedLineItemsJson[0].artworkLinks);
});
test('same-revision refetch and parse flags do not reset a dirty editor', () => {
  render(); act(() => state.updateForm({ reviewNotes: 'Staff notes' }));
  render({ ...fixture(), hasNewerParse: true, updatedAt: '2026-11-02T22:00:00Z' });
  expect(state.form?.reviewNotes).toBe('Staff notes'); expect(state.serverChanged).toBe(false);
});
test('partial decimal text protects the draft before blur and stays with its queue record', () => {
  render(); act(() => state.setInputDraft('line:0:width', '2.'));
  render(fixture('a', 2));
  expect(state.inputDrafts['line:0:width']).toBe('2.');
  expect(state.serverChanged).toBe(true); expect(state.dirty).toBe(true);
  expect(state.expectedSnapshotId('a')).toBe('a-1');
  render(fixture('b')); expect(state.inputDrafts).toEqual({});
  render(fixture('a', 2)); expect(state.inputDrafts['line:0:width']).toBe('2.');
  act(() => { state.updateForm(current => ({ reviewedLineItemsJson: current.reviewedLineItemsJson.map(line => ({ ...line, width: 2.25 })) })); state.setInputDraft('line:0:width', null); });
  expect(state.inputDrafts).toEqual({}); expect(state.form?.reviewedLineItemsJson[0].width).toBe(2.25);
});
test('queue switching retains separate unsaved buffers and failed saves leave them dirty', () => {
  render(); act(() => state.updateForm({ reviewNotes: 'Keep A' }));
  render(fixture('b')); act(() => state.updateForm({ reviewNotes: 'Keep B' }));
  render(fixture()); expect(state.form?.reviewNotes).toBe('Keep A'); expect(state.dirty).toBe(true);
  render(fixture('b')); expect(state.form?.reviewNotes).toBe('Keep B');
});
test('successful save accepts canonical readback while obsolete query responses cannot roll it back', () => {
  render(); act(() => state.updateForm({ reviewNotes: 'Saved' })); const submitted = state.form!;
  act(() => state.acceptSaved('a', { ...fixture('a', 2), reviewNotes: 'Saved' }, submitted));
  render(fixture()); expect(state.form?.reviewNotes).toBe('Saved'); expect(state.dirty).toBe(false);
  expect(state.expectedSnapshotId('a')).toBe('a-2');
});
test('typing while save or explicit reconciliation is pending remains unsaved after the earlier result returns', () => {
  render(); const submitted = state.form!;
  act(() => state.updateForm({ reviewNotes: 'Typed while pending' }));
  act(() => state.acceptSaved('a', fixture('a', 2), submitted));
  expect(state.form?.reviewNotes).toBe('Typed while pending'); expect(state.dirty).toBe(true);
  expect(state.expectedSnapshotId('a')).toBe('a-2');
});
test('deliberate reconciliation accepts its confirmed result and background updates remain distinct', () => {
  render(); act(() => state.updateForm({ reviewNotes: 'Discarded only deliberately' })); const submitted = state.form!;
  act(() => state.acceptSaved('a', { ...fixture('a', 2), reviewNotes: 'Reconciled' }, submitted));
  expect(state.form).toEqual(cloneInboundReviewDraft({ ...fixture('a', 2), reviewNotes: 'Reconciled' }));
  expect(state.dirty).toBe(false);
});
test('late functional field patches apply to current form rather than replaying a captured sibling field', () => {
  render(); const latePricing = () => state.updateForm(current => ({ reviewedLineItemsJson: current.reviewedLineItemsJson.map(line => ({ ...line, pricingReviewJson: { ...line.pricingReviewJson, systemPriceCents: 16000 } })) }));
  act(() => state.updateForm(current => ({ reviewedLineItemsJson: current.reviewedLineItemsJson.map(line => ({ ...line, quantity: 28, notes: 'Keep this edit' })) })));
  act(latePricing); expect(state.form?.reviewedLineItemsJson[0]).toMatchObject({ quantity: 28, notes: 'Keep this edit' });
});
test('a late successful save response cannot hide an already observed newer concurrent revision', () => {
  render(); act(() => state.updateForm({ reviewNotes: 'My edit' })); const submitted = state.form!;
  render(fixture('a', 3));
  act(() => state.acceptSaved('a', { ...fixture('a', 2), reviewNotes: 'My edit' }, submitted));
  expect(state.form?.reviewNotes).toBe('My edit'); expect(state.serverChanged).toBe(true); expect(state.dirty).toBe(true);
  expect(state.expectedSnapshotId('a')).toBe('a-1');
});
