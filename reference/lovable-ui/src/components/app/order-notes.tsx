import { useEffect, useState } from "react";
import { NotebookPen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { SalesDoc } from "@/lib/mock/data";

/**
 * Compact document-level notes surfaced on the main Items workspace so staff never
 * have to open the Notes tab just to find out something important exists.
 * Shared by quotes and orders.
 */
export function OrderNotesStrip({
  doc,
  onSave,
}: {
  doc: SalesDoc;
  onSave: (patch: { notes?: string; customerNotes?: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [internal, setInternal] = useState(doc.notes ?? "");
  const [external, setExternal] = useState(doc.customerNotes ?? "");

  useEffect(() => {
    setInternal(doc.notes ?? "");
    setExternal(doc.customerNotes ?? "");
  }, [doc.notes, doc.customerNotes]);

  return (
    <div className="panel mb-3 flex flex-wrap items-start gap-x-6 gap-y-2 px-3 py-2">
      <div className="min-w-0 flex-1 basis-64">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Internal order note
        </div>
        <p className="text-[12px] leading-snug">
          {doc.notes || <span className="text-muted-foreground">No internal note.</span>}
        </p>
      </div>
      <div className="min-w-0 flex-1 basis-64">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Customer-facing note
        </div>
        <p className="text-[12px] leading-snug">
          {doc.customerNotes || (
            <span className="text-muted-foreground">No customer-facing note.</span>
          )}
        </p>
      </div>
      <Button
        size="sm"
        variant="outline"
        className="h-7 shrink-0 gap-1 text-[11px]"
        onClick={() => setOpen(true)}
      >
        <NotebookPen className="size-3" /> Edit notes
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {doc.documentType} #{doc.number} notes
            </DialogTitle>
            <DialogDescription>
              Document-level notes. Line item notes stay on the individual line in the editor.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="grid gap-1">
              <Label className="text-[11px] uppercase text-muted-foreground">
                Internal (staff only)
              </Label>
              <Textarea
                rows={5}
                className="text-[13px]"
                value={internal}
                onChange={(e) => setInternal(e.target.value)}
              />
            </div>
            <div className="grid gap-1">
              <Label className="text-[11px] uppercase text-muted-foreground">Customer-facing</Label>
              <Textarea
                rows={5}
                className="text-[13px]"
                value={external}
                onChange={(e) => setExternal(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                onSave({ notes: internal, customerNotes: external });
                setOpen(false);
              }}
            >
              Save notes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
