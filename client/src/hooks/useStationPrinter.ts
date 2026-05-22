/**
 * useStationPrinter — shared station printer-preference state for ticket and
 * traveler print pages.
 *
 * The MVP browser/Windows print flow cannot select a printer silently, so this
 * just remembers which printer name the station should pick in the print
 * dialog (persisted per browser via localStorage — see lib/ticketSettings).
 */

import { useCallback, useEffect, useState } from "react";
import {
  loadPrinterPrefs,
  savePrinterPrefs,
  type TicketPrinterPrefs,
} from "@/lib/ticketSettings";

export interface StationPrinterController {
  prefs: TicketPrinterPrefs;
  selectedPrinter: string;
  newPrinter: string;
  setNewPrinter: (value: string) => void;
  selectPrinter: (name: string) => void;
  savePrinter: () => void;
}

export function useStationPrinter(): StationPrinterController {
  const [prefs, setPrefs] = useState<TicketPrinterPrefs>(() => loadPrinterPrefs());
  const [selectedPrinter, setSelectedPrinter] = useState<string>("");
  const [newPrinter, setNewPrinter] = useState("");

  // Default the selector to the station's saved default printer.
  useEffect(() => {
    if (!selectedPrinter && prefs.defaultPrinter) {
      setSelectedPrinter(prefs.defaultPrinter);
    }
  }, [prefs.defaultPrinter, selectedPrinter]);

  const selectPrinter = useCallback(
    (name: string) => {
      setSelectedPrinter(name);
      // Selecting a printer also makes it this station's default.
      setPrefs((current) => {
        const next: TicketPrinterPrefs = { ...current, defaultPrinter: name };
        savePrinterPrefs(next);
        return next;
      });
    },
    [],
  );

  const savePrinter = useCallback(() => {
    const name = newPrinter.trim();
    if (!name) return;
    setPrefs((current) => {
      const printers = current.printers.includes(name)
        ? current.printers
        : [...current.printers, name];
      const next: TicketPrinterPrefs = { printers, defaultPrinter: name };
      savePrinterPrefs(next);
      return next;
    });
    setSelectedPrinter(name);
    setNewPrinter("");
  }, [newPrinter]);

  return { prefs, selectedPrinter, newPrinter, setNewPrinter, selectPrinter, savePrinter };
}
