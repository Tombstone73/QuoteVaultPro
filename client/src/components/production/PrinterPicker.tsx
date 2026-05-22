/**
 * PrinterPicker — shared "Print To" selector + add-printer row used by the
 * production ticket and order traveler print pages.
 *
 * MVP: this only guides the operator to pick the right printer in the browser
 * print dialog; it does not print silently.
 */

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { StationPrinterController } from "@/hooks/useStationPrinter";

export function PrinterPicker({ printer }: { printer: StationPrinterController }) {
  const { prefs, selectedPrinter, newPrinter, setNewPrinter, selectPrinter, savePrinter } = printer;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-muted-foreground">Print To:</span>
        <Select value={selectedPrinter || undefined} onValueChange={selectPrinter}>
          <SelectTrigger className="h-8 w-[180px] text-xs">
            <SelectValue placeholder="Choose printer…" />
          </SelectTrigger>
          <SelectContent>
            {prefs.printers.length === 0 ? (
              <div className="px-2 py-1.5 text-xs text-muted-foreground">No saved printers</div>
            ) : (
              prefs.printers.map((p) => (
                <SelectItem key={p} value={p} className="text-xs">
                  {p}
                  {p === prefs.defaultPrinter ? "  (default)" : ""}
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={newPrinter}
          onChange={(e) => setNewPrinter(e.target.value)}
          placeholder="Add a printer name (e.g. Epson TM-L90)…"
          className="h-8 max-w-xs text-xs"
          onKeyDown={(e) => {
            if (e.key === "Enter") savePrinter();
          }}
        />
        <Button onClick={savePrinter} size="sm" variant="outline" disabled={!newPrinter.trim()}>
          Save Printer
        </Button>
        {selectedPrinter && (
          <span className="text-xs text-muted-foreground">
            Select <strong>{selectedPrinter}</strong> in the print dialog.
          </span>
        )}
      </div>
    </div>
  );
}
