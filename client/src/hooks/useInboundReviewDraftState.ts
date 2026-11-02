import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react';
import type { InboundOrderReviewDraftDto, InboundOrderReviewDraftSaveRequest } from '@shared/inboundOrdersApi';

export type InboundReviewForm = InboundOrderReviewDraftSaveRequest;
export type InboundReviewFormPatch = Partial<InboundReviewForm> | ((current: InboundReviewForm) => Partial<InboundReviewForm>);
export function cloneInboundReviewDraft(draft: InboundOrderReviewDraftDto): InboundReviewForm {
  return JSON.parse(JSON.stringify({ status: 'draft', reviewedCustomerJson: draft.reviewedCustomerJson,
    reviewedOrderJson: { ...draft.reviewedOrderJson, intent: draft.reviewedOrderJson.intent ?? 'unknown', priority: draft.reviewedOrderJson.priority ?? 'normal' },
    reviewedLineItemsJson: draft.reviewedLineItemsJson, reviewedArtworkJson: draft.reviewedArtworkJson,
    missingDecisionsJson: draft.missingDecisionsJson, warningsJson: draft.warningsJson,
    unsupportedRequestsJson: draft.unsupportedRequestsJson ?? [], customerIntelligenceJson: draft.customerIntelligenceJson ?? null,
    reviewNotes: draft.reviewNotes }));
}
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
type Entry = { form: InboundReviewForm; base: InboundReviewForm; snapshotId: string | null; version: number; seenVersion: number; serverChanged: boolean };
const entryFrom = (draft: InboundOrderReviewDraftDto): Entry => {
  const base = cloneInboundReviewDraft(draft);
  return { form: base, base, snapshotId: draft.snapshotId, version: draft.snapshotVersion ?? 0, seenVersion: draft.snapshotVersion ?? 0, serverChanged: false };
};

/** Local editing belongs to the inbound adapter, not the query cache or shared
 * ordinary editor. Unsaved drafts survive record switches for this page session.
 * Only a confirmed save or deliberate reload/reconciliation advances the base. */
export function useInboundReviewDraftState(recordId: string | null, server: InboundOrderReviewDraftDto | null) {
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const change = useCallback((update: (current: Record<string, Entry>) => Record<string, Entry>) => {
    const next = update(entriesRef.current);
    entriesRef.current = next;
    setEntries(next);
  }, []);
  useEffect(() => {
    if (!recordId || !server || server.inboundOrderRecordId !== recordId) return;
    change(current => {
      const previous = current[recordId];
      if (previous && ((server.snapshotVersion ?? 0) < previous.seenVersion || server.snapshotId === previous.snapshotId)) return current;
      if (previous && !equal(previous.form, previous.base)) {
        return { ...current, [recordId]: { ...previous, seenVersion: server.snapshotVersion ?? 0, serverChanged: true } };
      }
      return { ...current, [recordId]: entryFrom(server) };
    });
  }, [recordId, server?.snapshotId, server?.snapshotVersion, change]);
  const setFormForRecord = useCallback((id: string, update: SetStateAction<InboundReviewForm | null>) => {
    change(current => {
      const entry = current[id];
      if (!entry) return current;
      const form = typeof update === 'function' ? update(entry.form) : update;
      return form ? { ...current, [id]: { ...entry, form } } : current;
    });
  }, [change]);
  const setForm = useCallback((update: SetStateAction<InboundReviewForm | null>) => {
    if (recordId) setFormForRecord(recordId, update);
  }, [recordId, setFormForRecord]);
  const updateForm = useCallback((patch: InboundReviewFormPatch) => {
    setForm(current => current ? { ...current, ...(typeof patch === 'function' ? patch(current) : patch) } : current);
  }, [setForm]);
  const expectedSnapshotId = useCallback((id: string) => entriesRef.current[id]?.snapshotId, []);
  const acceptSaved = useCallback((id: string, draft: InboundOrderReviewDraftDto, submitted?: InboundReviewForm) => {
    if (draft.inboundOrderRecordId !== id) return;
    change(current => {
      const previous = current[id];
      if (previous && (draft.snapshotVersion ?? 0) < previous.seenVersion) return current;
      const next = entryFrom(draft);
      // Typing after clicking Save/Refresh still belongs to staff, even when
      // the earlier request succeeds. It remains dirty against the saved base.
      if (previous && submitted && !equal(previous.form, submitted)) next.form = previous.form;
      return { ...current, [id]: next };
    });
  }, [change]);
  const entry = recordId ? entries[recordId] : undefined;
  return { form: entry?.form ?? null, base: entry?.base ?? null, dirty: Boolean(entry && !equal(entry.form, entry.base)),
    serverChanged: entry?.serverChanged ?? false, setForm, setFormForRecord, updateForm, expectedSnapshotId, acceptSaved };
}
