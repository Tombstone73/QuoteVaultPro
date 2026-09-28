import { useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { FULFILLMENT_HISTORY_NOTE_MAX_LENGTH, type FulfillmentHistoryNote } from "@shared/fulfillmentHistoryNote";

export function PickupHistoryNote({ handoffId, note, canEdit, onSave }: {
  handoffId: string;
  note?: FulfillmentHistoryNote | null;
  canEdit: boolean;
  onSave?: (handoffId: string, note: string) => Promise<unknown>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    if (!onSave || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(handoffId, draft.trim());
      setEditing(false);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not save note. Please try again.");
    } finally {
      setSaving(false);
    }
  }
  return <div className="mt-2" data-testid={`pickup-note-${handoffId}`}>
    {note && <div>
      <p className="font-medium">Internal note</p>
      <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{note.text}</p>
      <p className="text-xs text-muted-foreground">Updated {new Date(note.updatedAt).toLocaleString()}{note.actorName ? ` by ${note.actorName}` : note.actorUserId ? ` by staff ${note.actorUserId}` : ""}</p>
    </div>}
    {canEdit && onSave && (editing ? <div className="mt-2 space-y-2">
      <label className="text-xs font-medium" htmlFor={`pickup-note-input-${handoffId}`}>Internal pickup note</label>
      <Textarea id={`pickup-note-input-${handoffId}`} value={draft} maxLength={FULFILLMENT_HISTORY_NOTE_MAX_LENGTH}
        disabled={saving} onChange={event => setDraft(event.target.value)} className="min-h-20" autoFocus />
      <p className="text-xs text-muted-foreground">Staff history only. Clear the text and save to remove the note. {draft.length}/{FULFILLMENT_HISTORY_NOTE_MAX_LENGTH}</p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <button type="button" disabled={saving} onClick={() => void save()} className="rounded bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50">{saving ? "Saving…" : "Save note"}</button>
        <button type="button" disabled={saving} onClick={() => setEditing(false)} className="rounded border px-3 py-2 text-sm">Cancel</button>
      </div>
    </div> : <button type="button" className="mt-1 rounded border px-2 py-1 text-xs" onClick={() => { setDraft(note?.text ?? ""); setError(null); setEditing(true); }}>{note ? "Edit note" : "Add note"}</button>)}
  </div>;
}
