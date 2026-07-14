import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  TitanCard,
  TitanTable,
  TitanTableBody,
  TitanTableCell,
  TitanTableContainer,
  TitanTableHead,
  TitanTableHeader,
  TitanTableRow,
} from "@/components/titan";
import { PrinterProfileForm, PRINTER_TYPE_LABELS } from "@/components/production/PrinterProfileForm";
import {
  PrinterProfile,
  useDeactivatePrinterProfile,
  useDeletePrinterProfile,
  usePrinterProfiles,
  useSetDefaultPrinterProfile,
} from "@/hooks/usePrinterProfiles";
import { Edit, Plus, Star, Trash2 } from "lucide-react";

function formatDate(value?: string | null) {
  return value ? value.substring(0, 10) : "Never";
}

export default function PrinterSettingsPage() {
  const { data: profiles = [], isLoading } = usePrinterProfiles();
  const setDefaultMutation = useSetDefaultPrinterProfile();
  const deactivateMutation = useDeactivatePrinterProfile();
  const deleteMutation = useDeletePrinterProfile();
  const [editing, setEditing] = useState<PrinterProfile | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  async function handleDelete(profile: PrinterProfile) {
    if (!window.confirm(`Delete printer profile "${profile.displayName}"?`)) return;
    await deleteMutation.mutateAsync(profile.id);
  }

  return (
    <div className="space-y-6">
      <TitanCard className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-titan-lg font-semibold text-titan-text-primary">Printers</h2>
            <p className="mt-1 text-titan-sm text-titan-text-secondary">
              Manage organization-wide printer profiles used to guide production ticket and document printing.
            </p>
            <p className="mt-2 text-xs text-titan-text-muted">
              Current printing opens the browser print dialog. Profiles do not map to physical devices yet.
            </p>
          </div>
          <Button onClick={() => setShowAdd(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add Printer
          </Button>
        </div>
      </TitanCard>

      <TitanTableContainer>
        <TitanTable>
          <TitanTableHeader>
            <TitanTableRow>
              <TitanTableHead>Display Name</TitanTableHead>
              <TitanTableHead>Type</TitanTableHead>
              <TitanTableHead>Intended Use</TitanTableHead>
              <TitanTableHead>Status</TitanTableHead>
              <TitanTableHead>Default</TitanTableHead>
              <TitanTableHead>Scope</TitanTableHead>
              <TitanTableHead>Last Used</TitanTableHead>
              <TitanTableHead className="text-right">Actions</TitanTableHead>
            </TitanTableRow>
          </TitanTableHeader>
          <TitanTableBody>
            {isLoading && (
              <TitanTableRow>
                <TitanTableCell colSpan={8}>Loading printer profiles...</TitanTableCell>
              </TitanTableRow>
            )}
            {!isLoading && profiles.length === 0 && (
              <TitanTableRow>
                <TitanTableCell colSpan={8}>
                  <div className="py-8 text-center text-titan-text-secondary">
                    No printer profiles are configured.
                  </div>
                </TitanTableCell>
              </TitanTableRow>
            )}
            {profiles.map((profile) => (
              <TitanTableRow key={profile.id}>
                <TitanTableCell className="font-medium">{profile.displayName}</TitanTableCell>
                <TitanTableCell>{PRINTER_TYPE_LABELS[profile.printerType]}</TitanTableCell>
                <TitanTableCell>{profile.stationRoute || profile.intendedUse.replace(/_/g, " ")}</TitanTableCell>
                <TitanTableCell>
                  <Badge variant={profile.isActive ? "default" : "secondary"}>{profile.isActive ? "Active" : "Inactive"}</Badge>
                </TitanTableCell>
                <TitanTableCell>{profile.isDefault ? <Badge variant="outline">Default</Badge> : "-"}</TitanTableCell>
                <TitanTableCell>Organization-wide</TitanTableCell>
                <TitanTableCell>{formatDate(profile.lastUsedAt)}</TitanTableCell>
                <TitanTableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(profile)}>
                      <Edit className="h-4 w-4" />
                    </Button>
                    {profile.isActive && !profile.isDefault && (
                      <Button size="sm" variant="ghost" onClick={() => setDefaultMutation.mutate(profile.id)}>
                        <Star className="h-4 w-4" />
                      </Button>
                    )}
                    {profile.isActive && (
                      <Button size="sm" variant="ghost" onClick={() => deactivateMutation.mutate(profile.id)}>
                        Deactivate
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => handleDelete(profile)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </TitanTableCell>
              </TitanTableRow>
            ))}
          </TitanTableBody>
        </TitanTable>
      </TitanTableContainer>

      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Printer Profile</DialogTitle>
            <DialogDescription>Create an organization-wide print destination label.</DialogDescription>
          </DialogHeader>
          <PrinterProfileForm onSaved={() => setShowAdd(false)} onCancel={() => setShowAdd(false)} />
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(editing)} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Printer Profile</DialogTitle>
            <DialogDescription>Update the printer profile label, type, default, or active state.</DialogDescription>
          </DialogHeader>
          <PrinterProfileForm profile={editing} onSaved={() => setEditing(null)} onCancel={() => setEditing(null)} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
