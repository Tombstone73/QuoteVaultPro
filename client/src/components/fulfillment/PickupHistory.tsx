import { useState } from "react";
import type { FulfillmentDetail } from "@/hooks/useFulfillment";
import type { PickupTravelerHistoryEntry } from "@shared/pickupTravelerProgress";
import { currentLocalPickupDate, displayPickupDate } from "@shared/pickupEffectiveDate";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type Handoff = FulfillmentDetail["pickupHandoffs"][number];
type Props = {
  detail: FulfillmentDetail;
  selectedTravelerIds: string[];
  onToggle: (id: string, selected: boolean) => void;
  onReprint: (traveler: PickupTravelerHistoryEntry) => void;
  onReverse: (handoff: Handoff) => void;
  onSaveDetails?: (handoffId: string, changes: { effectivePickupDate?: string; note?: string }) => Promise<unknown>;
};

export function PickupHistory({ detail, selectedTravelerIds, onToggle, onReprint, onReverse, onSaveDetails }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftDate, setDraftDate] = useState("");
  const [draftNote, setDraftNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const travelers = detail.pickupTravelers ?? [];
  const prepared = travelers.filter(t => !t.pickupHandoffId);
  const canEditDate = detail.permissions?.canEditPickupDate === true;
  const canEditNote = detail.permissions?.canEditHistoryNotes === true;
  const reprint = (t: PickupTravelerHistoryEntry) => <button key={t.id} type="button" className="rounded border px-3 py-2" onClick={() => onReprint(t)}>
    {t.id.startsWith("handoff:") ? "Print Traveler" : "Reprint Traveler"}{t.box ? ` · Box ${t.box.current} of ${t.box.total}` : t.printBlankBoxFields ? " · BOX ____ of ____" : ""}
  </button>;
  function startEdit(handoff: Handoff) {
    setEditingId(handoff.id);
    setDraftDate(handoff.effectivePickupDate || handoff.handedOffAt.slice(0, 10));
    setDraftNote(handoff.notes ?? "");
    setError(null);
  }
  async function save() {
    if (!editingId || !onSaveDetails || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSaveDetails(editingId, { ...(canEditDate ? { effectivePickupDate: draftDate } : {}), ...(canEditNote ? { note: draftNote.trim() } : {}) });
      setEditingId(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save pickup details.");
    } finally {
      setSaving(false);
    }
  }
  return <>
    {prepared.length > 0 && <section className="rounded-xl border bg-card p-4" data-testid="prepared-travelers">
      <h2 className="font-bold">Prepared Travelers</h2>
      <p className="text-sm text-muted-foreground">Select paperwork belonging to this pickup before completing it. Reprints keep the saved quantities.</p>
      {prepared.map(t => <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 border-t py-2 text-sm">
        <div><p>{new Date(t.createdAt).toLocaleString()}</p><p>{t.lines.map(l => `${l.quantity} ${l.description}`).join(" · ")}</p>
          {detail.fulfillmentType === "PICKUP" && detail.remainingQuantity > 0 && <label><input type="checkbox" checked={selectedTravelerIds.includes(t.id)} onChange={e => onToggle(t.id, e.target.checked)} /> Include in this pickup</label>}
        </div>{reprint(t)}
      </div>)}
    </section>}
    {detail.pickupHandoffs.length > 0 && <section className="rounded-xl border bg-card px-4 py-3" data-testid="pickup-history">
      <h2 className="font-bold">Pickup History</h2><div className="mt-2 divide-y">{detail.pickupHandoffs.map(handoff => {
        const saved = travelers.filter(t => t.pickupHandoffId === handoff.id);
        const pickupDate = handoff.effectivePickupDate || handoff.handedOffAt.slice(0, 10);
        const recordedAt = handoff.recordedAt || handoff.handedOffAt;
        const recordedDate = handoff.recordedDate || currentLocalPickupDate(new Date(recordedAt));
        const recordedBy = handoff.handedOffByName || (handoff.handedOffByUserId ? `staff ${handoff.handedOffByUserId}` : "Staff");
        const adjustment = handoff.dateAdjustments?.[0];
        return <div key={handoff.id} className="py-3 text-sm" data-testid={`pickup-${handoff.id}`}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div><p className="font-medium">{handoff.items.map(item => `${item.quantity} ${item.productName || item.description || "item"}`).join(" · ")} picked up · {displayPickupDate(pickupDate)}</p>
              <strong className={handoff.status?.includes("REVERSED") ? "text-destructive" : ""}>{handoff.status === "REVERSED" ? "Reversed" : handoff.status === "PARTIALLY_REVERSED" ? "Partially reversed" : "Completed"}</strong>
              {recordedDate !== pickupDate && <p className="text-xs text-muted-foreground">Recorded {displayPickupDate(recordedDate)} by {recordedBy}</p>}
              {recordedDate === pickupDate && <p className="text-xs text-muted-foreground">Recorded by {recordedBy}</p>}
            </div>
            <div className="flex gap-2">{onSaveDetails && (canEditDate || canEditNote) && <button type="button" className="rounded border px-2 py-1 text-xs font-semibold" onClick={() => startEdit(handoff)}>Edit details</button>}
              {detail.permissions?.canReverseTerminalFulfillment && handoff.status !== "REVERSED" && <button type="button" className="rounded border border-destructive/40 px-2 py-1 text-xs font-semibold text-destructive" onClick={() => onReverse(handoff)}>Reverse Pickup</button>}</div>
          </div>
          {handoff.notes && <p className="mt-1 whitespace-pre-wrap break-words text-muted-foreground">{handoff.notes}</p>}
          {adjustment && <p className="mt-1 text-xs text-muted-foreground">Pickup date adjusted from {displayPickupDate(adjustment.previousEffectiveDate)} to {displayPickupDate(adjustment.newEffectiveDate)} · Edited {new Date(adjustment.editedAt).toLocaleDateString()}{adjustment.actorName ? ` by ${adjustment.actorName}` : ""}</p>}
          {handoff.reversals?.map(reversal => <p key={reversal.id} className="mt-1 text-muted-foreground">Reversed{reversal.createdAt ? ` ${new Date(reversal.createdAt).toLocaleString()}` : ""}{reversal.actorName ? ` by ${reversal.actorName}` : reversal.actorUserId ? ` by staff ${reversal.actorUserId}` : ""}{reversal.reason ? ` — ${reversal.reason}` : ""}</p>)}
          {editingId === handoff.id && <div className="mt-2 space-y-2 rounded border p-3" data-testid={`pickup-edit-${handoff.id}`}>
            {canEditDate && <label className="grid gap-1 text-xs font-medium">Pickup date<Input type="date" aria-label="Edit pickup date" value={draftDate} max={detail.operationalPickupDate || currentLocalPickupDate()} disabled={saving} onChange={event => setDraftDate(event.target.value)} /></label>}
            {canEditNote && <label className="grid gap-1 text-xs font-medium">Pickup note<Textarea aria-label="Edit pickup note" value={draftNote} maxLength={2000} className="min-h-16" disabled={saving} onChange={event => setDraftNote(event.target.value)} /></label>}
            <p className="text-xs text-muted-foreground">Quantity corrections use Reverse Pickup. Original record date and recorded-by user stay unchanged.</p>
            {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
            <div className="flex gap-2"><button type="button" disabled={saving || (canEditDate && !draftDate)} className="rounded bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50" onClick={() => void save()}>{saving ? "Saving…" : "Save details"}</button><button type="button" disabled={saving} className="rounded border px-3 py-1.5 text-xs" onClick={() => setEditingId(null)}>Cancel</button></div>
          </div>}
          {saved.length ? <div className="mt-2 flex flex-wrap gap-2">{saved.map(reprint)}</div> : <p className="text-xs text-muted-foreground">No saved Traveler associated with this pickup.</p>}
        </div>;
      })}</div>
    </section>}
  </>;
}
