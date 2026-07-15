import { Button } from "@/components/ui/button";

export function QuoteListNote({ note, onEdit }: { note: string | null | undefined; onEdit: () => void }) {
  const fullNote = note?.trim() ?? "";
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={onEdit}
      title={fullNote || "Add list note"}
      aria-label={fullNote ? `Edit list note. Full note: ${fullNote}` : "Add list note"}
      className="h-auto w-full min-w-0 justify-start whitespace-normal rounded px-2 py-1 text-left hover:bg-muted/30"
    >
      {fullNote ? (
        <span className="line-clamp-3 min-w-0 break-words text-sm [overflow-wrap:anywhere]" data-testid="quote-list-note-clamped">
          {fullNote}
        </span>
      ) : (
        <span className="text-sm italic text-muted-foreground">Click to add...</span>
      )}
    </Button>
  );
}
