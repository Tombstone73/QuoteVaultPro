import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/queryClient";
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
  readPrinterProfileJson,
} from "@/hooks/usePrinterProfiles";
import { Edit, Plus, Printer, Star, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";

function formatDate(value?: string | null) {
  return value ? value.substring(0, 10) : "Never";
}

export default function PrinterSettingsPage() {
  const { data: profiles = [], isLoading } = usePrinterProfiles();
  const agents = useQuery<Array<{ id: string; machineLabel: string | null; name: string; agentVersion: string | null; lastSeenAt: string | null }>>({
    queryKey: ["/api/local-bridge/admin/agents", "printer-list"],
    queryFn: async () => readPrinterProfileJson<Array<{ id: string; machineLabel: string | null; name: string; agentVersion: string | null; lastSeenAt: string | null }>>(await apiFetch("/api/local-bridge/admin/agents"), "Could not load paired workstations."),
  });
  const agentById = new Map((agents.data ?? []).map(agent => [agent.id, agent]));
  const setDefaultMutation = useSetDefaultPrinterProfile();
  const deactivateMutation = useDeactivatePrinterProfile();
  const deleteMutation = useDeletePrinterProfile();
  const [editing, setEditing] = useState<PrinterProfile | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [testPendingId, setTestPendingId] = useState<string | null>(null);
  const [testJob, setTestJob] = useState<{ profileId: string; jobId: string; agentLastSeenAt: string | null } | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const testStatus = useQuery<{ status: string; lastError: string | null }>({
    queryKey: ['printer-profile-test', testJob?.jobId], enabled: Boolean(testJob),
    queryFn: async () => readPrinterProfileJson(await apiFetch(`/api/printer-profiles/${testJob!.profileId}/test-print/${testJob!.jobId}`), 'Could not read test print status.'),
    refetchInterval: query => ['submitted', 'failed'].includes(query.state.data?.status ?? '') ? false : 1500,
  });

  async function handleTestPrint(profile: PrinterProfile) {
    if (testPendingId) return;
    setTestPendingId(profile.id); setTestError(null); setTestJob(null);
    try {
      const response = await apiFetch(`/api/printer-profiles/${profile.id}/test-print`, {
        method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, credentials: 'include' });
      const job = await readPrinterProfileJson<{ id: string; agentLastSeenAt: string | null }>(response, 'Could not queue test print.');
      setTestJob({ profileId: profile.id, jobId: job.id, agentLastSeenAt: job.agentLastSeenAt });
    } catch (error) { setTestError(error instanceof Error ? error.message : 'Could not queue test print.'); }
    finally { setTestPendingId(null); }
  }

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
              Manage the saved profiles used for Travelers, shipping labels, Quick Notes, and office documents. Each direct-print profile belongs to one paired workstation and one exact Windows queue.
            </p>
            <p className="mt-2 text-xs text-titan-text-muted">Test Print uses the saved profile and its paired Windows Print Agent. The job status confirms spool submission, not paper output.</p>
            <p className="mt-2 text-xs text-titan-text-muted">Setup: <Link className="underline" to="/settings/local-bridge">install and pair the Print Agent</Link> → choose a reported Windows queue → choose document purpose and media → set a default → Test Print. One paired installation can serve multiple printers after the 1.0.28 update; adding a printer does not require another token.</p>
          </div>
          <Button onClick={() => setShowAdd(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add Printer
          </Button>
        </div>
      </TitanCard>

      {(testJob || testError) && <div role={testError ? 'alert' : 'status'} className="rounded border p-3 text-sm">
        {testError ? <p className="text-destructive">Test print failed: {testError}</p> : testJob && <>
          <p>Test print job {testJob.jobId}: {testStatus.data?.status === 'submitted' ? 'Submitted to the Windows spooler; check the physical printer.'
            : testStatus.data?.status === 'failed' ? `Agent failed: ${testStatus.data.lastError || 'Check the agent log and Windows queue.'}`
            : testStatus.data?.status === 'claimed' || testStatus.data?.status === 'rendering' ? 'Agent processing.' : 'Queued for the paired agent.'}</p>
          {testJob.agentLastSeenAt && <p className="text-xs text-titan-text-secondary">Agent last contact: {new Date(testJob.agentLastSeenAt).toLocaleString()} (last seen, not proof it is online now).</p>}
          {testStatus.isError && <p className="text-destructive">Could not read job status. Refresh this page or check the agent log using job {testJob.jobId}.</p>}
        </>}
      </div>}

      <TitanTableContainer>
        <TitanTable>
          <TitanTableHeader>
            <TitanTableRow>
              <TitanTableHead>Display Name</TitanTableHead>
              <TitanTableHead>Type</TitanTableHead>
              <TitanTableHead>Intended Use</TitanTableHead>
              <TitanTableHead>Windows queue</TitanTableHead>
              <TitanTableHead>Workstation</TitanTableHead>
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
                <TitanTableCell colSpan={10}>Loading printer profiles...</TitanTableCell>
              </TitanTableRow>
            )}
            {!isLoading && profiles.length === 0 && (
              <TitanTableRow>
                <TitanTableCell colSpan={10}>
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
                <TitanTableCell>{profile.windowsQueueName || "Not selected"}</TitanTableCell>
                <TitanTableCell>{profile.printAgentId ? (agentById.get(profile.printAgentId)?.machineLabel || agentById.get(profile.printAgentId)?.name || "Agent identity unavailable") : "Not paired"}</TitanTableCell>
                <TitanTableCell>
                  <Badge variant={profile.isActive ? "default" : "secondary"}>{profile.isActive ? "Active" : "Inactive"}</Badge>
                </TitanTableCell>
                <TitanTableCell>{profile.isDefault ? <Badge variant="outline">Default</Badge> : "-"}</TitanTableCell>
                <TitanTableCell>Organization-wide</TitanTableCell>
                <TitanTableCell>{formatDate(profile.lastUsedAt)}</TitanTableCell>
                <TitanTableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button size="sm" variant="outline" disabled={Boolean(testPendingId)} onClick={() => void handleTestPrint(profile)}>
                      <Printer className="mr-1 h-4 w-4" />{testPendingId === profile.id ? 'Queuing…' : 'Test Print'}
                    </Button>
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
