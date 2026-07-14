/**
 * PrinterPicker — shared printer profile selector used by ticket/traveler print pages.
 *
 * Profiles guide the operator to the right destination in the browser print
 * dialog. They do not bypass the browser dialog or map to physical devices yet.
 */

import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { StationPrinterController } from "@/hooks/useStationPrinter";
import { PrinterProfileForm } from "@/components/production/PrinterProfileForm";
import { Settings } from "lucide-react";

export function PrinterPicker({ printer }: { printer: StationPrinterController }) {
  const [showAdd, setShowAdd] = useState(false);
  const { profiles, isLoading, selectedProfile, selectedProfileId, selectPrinterProfile } = printer;

  if (isLoading) {
    return <div className="text-xs text-muted-foreground">Loading printer profiles...</div>;
  }

  if (profiles.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-3">
        <div className="text-sm font-medium">No printer profiles are configured.</div>
        <div className="mt-1 text-xs text-muted-foreground">
          Add an organization-wide printer profile before testing production tickets.
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button asChild size="sm" variant="outline">
            <Link to="/settings/printers">
              <Settings className="mr-2 h-4 w-4" />
              Manage Printers
            </Link>
          </Button>
          <Button size="sm" onClick={() => setShowAdd(true)}>Add Printer Profile</Button>
        </div>
        <Dialog open={showAdd} onOpenChange={setShowAdd}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Printer Profile</DialogTitle>
              <DialogDescription>Create the same printer profile used by Settings.</DialogDescription>
            </DialogHeader>
            <PrinterProfileForm compact onSaved={() => setShowAdd(false)} onCancel={() => setShowAdd(false)} />
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">Printer profile:</span>
        <Select value={selectedProfileId || undefined} onValueChange={selectPrinterProfile}>
          <SelectTrigger className="h-8 w-[240px] text-xs">
            <SelectValue placeholder={profiles.length > 1 ? "Select printer profile..." : "Choose printer profile..."} />
          </SelectTrigger>
          <SelectContent>
            {profiles.map((profile) => (
              <SelectItem key={profile.id} value={profile.id} className="text-xs">
                {profile.displayName}
                {profile.isDefault ? " (default)" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button asChild size="sm" variant="outline">
          <Link to="/settings/printers">Manage Printers</Link>
        </Button>
        <Button size="sm" variant="outline" onClick={() => setShowAdd(true)}>Add Printer</Button>
      </div>
      <div className="text-xs text-muted-foreground">
        {selectedProfile
          ? <>The browser print dialog will still open. Select <strong>{selectedProfile.displayName}</strong> there.</>
          : "Select a printer profile before printing when multiple profiles are available."}
      </div>
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Printer Profile</DialogTitle>
            <DialogDescription>Create the same printer profile used by Settings.</DialogDescription>
          </DialogHeader>
          <PrinterProfileForm compact onSaved={() => setShowAdd(false)} onCancel={() => setShowAdd(false)} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
