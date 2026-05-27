import { useState } from "react";
import { MessageSquarePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useAddProductionNote } from "@/hooks/useProduction";

export type ProductionNoteListItem = {
  id: string;
  text: string;
  createdAt: string;
  actorUserId?: string | null;
  edited?: boolean;
};

function formatNoteTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown time";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatActor(actorUserId: string | null | undefined): string {
  if (!actorUserId) return "Operator";
  return `User ${actorUserId.slice(-6)}`;
}

export function ProductionNotesSection({
  jobId,
  notes,
  title = "Production notes",
  className = "",
}: {
  jobId: string;
  notes: ProductionNoteListItem[] | undefined | null;
  title?: string;
  className?: string;
}) {
  const addNote = useAddProductionNote(jobId);
  const [open, setOpen] = useState(false);
  const [noteText, setNoteText] = useState("");
  const visibleNotes = [...(notes ?? [])]
    .filter((note) => note.text.trim())
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
  const newestNotes = visibleNotes.slice(0, 5);

  const handleSave = () => {
    const text = noteText.trim();
    if (!text) return;
    addNote.mutate(text, {
      onSuccess: () => {
        setNoteText("");
        setOpen(false);
      },
    });
  };

  return (
    <div className={`rounded-md border border-amber-400/40 bg-amber-400/10 px-3 py-2 ${className}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="text-[11px] uppercase tracking-wide text-amber-200">{title}</div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setOpen(true)}
          className="h-7 border-amber-300/50 bg-amber-100/10 px-2 text-[11px] text-amber-100 hover:bg-amber-100/20"
        >
          <MessageSquarePlus className="mr-1 h-3.5 w-3.5" />
          Add Production Note
        </Button>
      </div>

      {newestNotes.length > 0 ? (
        <div className="mt-2 max-h-32 space-y-2 overflow-y-auto">
          {newestNotes.map((note) => (
            <div key={note.id} className="rounded border border-amber-300/20 bg-black/10 p-2">
              <div className="mb-1 text-[11px] text-amber-100/75">
                {formatNoteTime(note.createdAt)} by {formatActor(note.actorUserId)}
              </div>
              <div className="whitespace-pre-wrap break-words text-sm text-titan-text-primary">{note.text}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-2 text-sm text-titan-text-muted">No production notes yet</div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Production Note</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {visibleNotes.length > 0 ? (
              <div className="max-h-48 space-y-2 overflow-y-auto rounded-md border bg-muted/30 p-2">
                {visibleNotes.map((note) => (
                  <div key={note.id} className="rounded-md border bg-background p-2">
                    <div className="mb-1 text-xs text-muted-foreground">
                      {formatNoteTime(note.createdAt)} by {formatActor(note.actorUserId)}
                    </div>
                    <div className="whitespace-pre-wrap text-sm">{note.text}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
                No production notes yet
              </div>
            )}
            <Textarea
              value={noteText}
              onChange={(event) => setNoteText(event.target.value)}
              placeholder="Add an append-only production note..."
              className="min-h-[110px]"
              disabled={addNote.isPending}
            />
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setNoteText("");
                  setOpen(false);
                }}
                disabled={addNote.isPending}
              >
                Cancel
              </Button>
              <Button type="button" onClick={handleSave} disabled={addNote.isPending || !noteText.trim()}>
                {addNote.isPending ? "Saving..." : "Save"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
