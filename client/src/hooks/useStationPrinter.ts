/**
 * useStationPrinter — organization printer-profile state for ticket and
 * traveler print pages.
 *
 * Browser printing cannot silently choose a physical printer. The selected
 * profile is a routing label that tells the operator which destination to pick
 * in the browser/OS print dialog.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  markPrinterProfileUsed,
  PrinterProfile,
  usePrinterProfiles,
} from "@/hooks/usePrinterProfiles";

export interface StationPrinterController {
  profiles: PrinterProfile[];
  isLoading: boolean;
  selectedProfileId: string;
  selectedProfile: PrinterProfile | null;
  selectPrinterProfile: (id: string) => void;
}

export function useStationPrinter(): StationPrinterController {
  const { data: profiles = [], isLoading } = usePrinterProfiles({
    active: true,
    intendedUse: "production_ticket",
  });
  const [selectedProfileId, setSelectedProfileId] = useState("");

  const defaultProfile = useMemo(
    () => profiles.find((profile) => profile.isDefault) ?? (profiles.length === 1 ? profiles[0] : null),
    [profiles],
  );

  useEffect(() => {
    if (!selectedProfileId && defaultProfile) {
      setSelectedProfileId(defaultProfile.id);
    }
  }, [defaultProfile, selectedProfileId]);

  const selectedProfile = profiles.find((profile) => profile.id === selectedProfileId) ?? null;

  const selectPrinterProfile = useCallback((id: string) => {
    setSelectedProfileId(id);
    if (id) void markPrinterProfileUsed(id);
  }, []);

  return { profiles, isLoading, selectedProfileId, selectedProfile, selectPrinterProfile };
}
