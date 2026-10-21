import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiUrl } from "@/lib/apiConfig";
import { apiFetch, apiRequest } from "@/lib/queryClient";
import { Link } from "react-router-dom";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

async function readJson<T>(url: string): Promise<T> { const response = await apiFetch(url); const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(body.error || "Could not load Print Agent information."); return body as T; }

// These must target the deployment's API origin, not the Vercel web host.
// The endpoints retain their existing authenticated Local Bridge admin middleware.
const travelerAgentDownloadUrl = apiUrl("/api/local-bridge/admin/traveler-print-agent-package");
const legacyBridgeAgentDownloadUrl = apiUrl("/api/local-bridge/admin/agent-package");

type AgentProfile = { id: string; displayName: string; windowsQueueName: string | null; isActive: boolean };
type AgentInfo = { id: string; name: string; status: string; machineLabel: string | null; agentVersion: string | null;
  configuredTravelerPrinterName: string | null; knownWindowsQueues: string[]; inventoryReportedAt: string | null;
  servesMultipleQueues: boolean; lastSeenAt: string | null; createdAt: string; revokedAt: string | null;
  profiles: AgentProfile[]; outstandingPrintJobs: number; outstandingCopyJobs: number };
type ReplacementPreview = { sourceId: string; targetId: string; outstandingPrintJobs: number; warning: string | null;
  profiles: Array<AgentProfile & { targetHasQueue: boolean }> };

export default function LocalBridgeSettings() {
  const queryClient = useQueryClient();
  const [name, setName] = useState("Shop workstation");
  const [token, setToken] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const agents = useQuery({ queryKey: ["/api/local-bridge/admin/agents"], queryFn: () => readJson<{ data: AgentInfo[] }>("/api/local-bridge/admin/agents") });
  const jobs = useQuery({ queryKey: ["/api/local-bridge/admin/jobs"], queryFn: () => readJson<any>("/api/local-bridge/admin/jobs") });
  const [replacementSourceId, setReplacementSourceId] = useState<string | null>(null);
  const [replacementTargetId, setReplacementTargetId] = useState("");
  const [replacementError, setReplacementError] = useState<string | null>(null);
  const replacementPreview = useQuery({ queryKey: ["print-agent-replacement", replacementSourceId, replacementTargetId],
    enabled: Boolean(replacementSourceId && replacementTargetId),
    queryFn: () => readJson<{ data: ReplacementPreview }>(`/api/local-bridge/admin/agents/${replacementSourceId}/replacement-preview?targetAgentId=${encodeURIComponent(replacementTargetId)}`),
  });
  const reassign = useMutation({ mutationFn: async () => {
    const preview = replacementPreview.data?.data;
    if (!preview) throw new Error("Load the replacement preview first.");
    const response = await apiFetch(`/api/local-bridge/admin/agents/${preview.sourceId}/reassign-profiles`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetAgentId: preview.targetId, expectedProfileIds: preview.profiles.map(profile => profile.id) }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || "Could not reassign printer profiles.");
    return body;
  }, onSuccess: () => { setReplacementSourceId(null); setReplacementTargetId(""); setReplacementError(null);
    void queryClient.invalidateQueries({ queryKey: ["/api/local-bridge/admin/agents"] });
    void queryClient.invalidateQueries({ queryKey: ["/api/printer-profiles"] });
  }, onError: (error: Error) => setReplacementError(error.message) });
  const create = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/local-bridge/admin/agents", { name })).json() as Promise<any>,
    onSuccess: (result: any) => {
      setToken(result.data.token);
      queryClient.invalidateQueries({ queryKey: ["/api/local-bridge/admin/agents"] });
    },
  });
  const revoke = useMutation({
    mutationFn: async (id: string) => { const response = await apiFetch(`/api/local-bridge/admin/agents/${id}/revoke`, { method: "POST" });
      const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(body.error || "Could not retire Print Agent."); },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/local-bridge/admin/agents"] }),
  });
  const allAgents = agents.data?.data ?? [];
  const activeAgents = allAgents.filter(agent => agent.status === "active");
  const copyToken = async () => {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token);
      setCopyFeedback("Copied to clipboard.");
    } catch {
      setCopyFeedback("Could not copy automatically. Select and copy the token manually.");
    }
  };
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Local Bridge</h2>
        <p className="text-sm text-muted-foreground">Optional outbound bridge for customer art-folder copies. The cloud backend never writes directly to your network.</p>
      </div>
      <div className="space-y-2 rounded border p-4">
        <h3 className="font-medium">PrintersHero Print Agent</h3>
        <p className="text-sm text-muted-foreground">Install this agent on the Windows computer that can access your printer queues. One paired installation can serve multiple printer profiles for Travelers, Quick Notes, UPS labels, and shipping documents. It includes .NET; WebView2 and the Windows printer drivers must also be installed.</p>
        <Button asChild><a href={travelerAgentDownloadUrl}>Download PrintersHero Print Agent</a></Button>
        <ol className="list-decimal space-y-1 pl-5 text-sm">
          <li>Install or locate the existing Print Agent on that workstation. For an update, extract over its stable folder and run <code>setup-agent.cmd</code>; setup reuses its saved pairing and startup task.</li>
          <li>Pair a new installation with one token below. That token authorizes this installation to claim this tenant's assigned print jobs and report its queues; it is not a token per printer. Create another only for a different installation, a revoked or lost pairing, or a compromised token.</li>
          <li>Confirm the agent reports version 1.0.28 or newer and its installed Windows queues below. An older agent can use only its original Traveler queue.</li>
          <li><Link className="underline" to="/settings/printers">Create a printer profile</Link> for each exact queue, choose its document purpose and media, set defaults, then use Test Print. Spool submission still requires checking the physical printer.</li>
        </ol>
        <p className="text-xs text-muted-foreground">On the workstation, run <code>.\setup-agent.ps1 -Check</code> for installation, task, process, and API diagnostics. Use <code>.\scripts\manage-agent-task.ps1 -Action status</code> to inspect the startup task, or <code>.\scripts\manage-agent-task.ps1 -Action restart</code> after installing another Windows queue. Logs: <code>%LOCALAPPDATA%\PrintersHero\print-agent.log</code>. Cloud deployment does not update the workstation.</p>
      </div>
      <div className="space-y-2 rounded border p-4">
        <h3 className="font-medium">Legacy Local Bridge Agent</h3>
        <p className="text-sm text-muted-foreground">This small Node.js agent copies customer artwork to local folders. It does not print Travelers.</p>
        <Button variant="outline" asChild><a href={legacyBridgeAgentDownloadUrl}>Download Legacy Local Bridge Agent</a></Button>
        <ol className="list-decimal pl-5 text-sm"><li>Download and extract the bridge package.</li><li>Run it on a shop PC or server.</li><li>Enter the API base URL and a pairing token.</li><li>Check its last API contact below; registration alone does not prove the process is running.</li></ol>
      </div>
      <div className="space-y-3 rounded border p-4">
        <p>Registered active identities: <b>{activeAgents.length}</b>. Last API contact is historical activity, not proof an agent is running or connected to Realtime.</p>
        <Input value={name} onChange={(event) => setName(event.target.value)} aria-label="New agent name" placeholder="e.g. Front counter Epson TM-L90" />
        <Button onClick={() => create.mutate()} disabled={create.isPending}>Create pairing token for another installation</Button>
        {token ? (
          <div className="break-all rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100" role="status" aria-live="polite">
            <div className="flex flex-wrap items-center gap-2">
              <span>Copy this token now; it will not be shown again:</span>
              <code className="font-mono font-medium">{token}</code>
              <Button type="button" size="sm" variant="outline" onClick={copyToken}>Copy token</Button>
            </div>
            {copyFeedback ? <p className="mt-2 font-medium">{copyFeedback}</p> : null}
          </div>
        ) : null}
        {allAgents.map((agent) => {
          const paired = Boolean(agent.machineLabel && agent.agentVersion);
          const possibleReplacement = allAgents.some(other => other.id !== agent.id && other.status === "active" &&
            agent.status === "active" && agent.machineLabel && other.machineLabel === agent.machineLabel);
          const canRetire = agent.status === "active" && agent.profiles.length === 0 &&
            agent.outstandingPrintJobs === 0 && agent.outstandingCopyJobs === 0;
          return (
          <div key={agent.id} className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
            <div className="min-w-0 space-y-1">
              <p className="font-medium">{agent.name} · {agent.status === "active" ? "Registered / enabled" : agent.status}</p>
              <p className="text-sm text-muted-foreground">Workstation: {agent.machineLabel || "Not paired yet"} · Reported version: {agent.agentVersion || "Not reported"}</p>
              <p className="text-sm text-muted-foreground">Initial Traveler queue: {agent.configuredTravelerPrinterName || "Not configured"}</p>
              <p className="text-sm text-muted-foreground">Known Windows queues: {agent.knownWindowsQueues?.length ? agent.knownWindowsQueues.join(" · ") : "No inventory reported"}</p>
              <p className="text-xs text-muted-foreground">{paired && agent.lastSeenAt ? `Last API contact: ${new Date(agent.lastSeenAt).toLocaleString()}` : "No installed agent contact confirmed"} · Queue inventory: {agent.inventoryReportedAt ? new Date(agent.inventoryReportedAt).toLocaleString() : "not reported"}</p>
              <p className="text-xs text-muted-foreground">Profiles: {agent.profiles.length ? agent.profiles.map(profile => `${profile.displayName} → ${profile.windowsQueueName || "no queue"}${profile.isActive ? "" : " (inactive)"}`).join(" · ") : "none"}</p>
              <p className="text-xs text-muted-foreground">Unfinished print jobs: {agent.outstandingPrintJobs} · Claimed local-copy jobs: {agent.outstandingCopyJobs}</p>
              {possibleReplacement ? <p className="text-xs text-amber-700">Possible duplicate or replacement identity on this workstation. Matching name alone does not prove which installation is current; compare queues, version, last contact, and assigned profiles.</p> : null}
            </div>
            <div className="flex flex-wrap gap-2">
              {agent.status === "active" && agent.profiles.length > 0 ? <Button variant="outline" size="sm" onClick={() => { setReplacementSourceId(agent.id); setReplacementTargetId(""); setReplacementError(null); }}>Review replacement</Button> : null}
              {agent.status === "active" ? <Button variant="destructive" size="sm" disabled={!canRetire || revoke.isPending} title={!canRetire ? "Resolve assigned profiles and unfinished jobs first" : undefined}
                onClick={() => { if (window.confirm(`Retire “${agent.name}”? Its token will stop working. Existing history remains.`)) revoke.mutate(agent.id); }}>Retire identity</Button> : null}
            </div>
          </div>
          );
        })}
        {revoke.error ? <p role="alert" className="text-sm text-destructive">{revoke.error.message}</p> : null}
      </div>
      <Dialog open={Boolean(replacementSourceId)} onOpenChange={(open) => { if (!open && !reassign.isPending) { setReplacementSourceId(null); setReplacementTargetId(""); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Review Print Agent replacement</DialogTitle><DialogDescription>Only future jobs use the replacement. Queued, claimed, and historical jobs retain their original agent. Exact Windows queue names are preserved.</DialogDescription></DialogHeader>
          <label className="space-y-1 text-sm">Replacement workstation
            <select className="h-10 w-full rounded border bg-background px-2" value={replacementTargetId} onChange={event => { setReplacementTargetId(event.target.value); setReplacementError(null); }}>
              <option value="">Choose an active paired agent</option>
              {activeAgents.filter(agent => agent.id !== replacementSourceId).map(agent => <option key={agent.id} value={agent.id}>{agent.machineLabel || agent.name} · {agent.agentVersion || "version unknown"}</option>)}
            </select>
          </label>
          {replacementPreview.isLoading ? <p>Checking exact queue mappings…</p> : null}
          {replacementPreview.isError ? <p role="alert" className="text-sm text-destructive">{replacementPreview.error.message}</p> : null}
          {replacementPreview.data?.data ? <div className="max-h-56 space-y-1 overflow-y-auto text-sm">
            {replacementPreview.data.data.profiles.map(profile => <p key={profile.id}>{profile.displayName}: {profile.windowsQueueName || "no queue"} · {profile.targetHasQueue ? "available on replacement" : "queue missing on replacement"}</p>)}
            {replacementPreview.data.data.warning ? <p className="text-amber-700">{replacementPreview.data.data.warning}</p> : null}
          </div> : null}
          {replacementError ? <p role="alert" className="text-sm text-destructive">{replacementError}</p> : null}
          <DialogFooter><Button variant="outline" disabled={reassign.isPending} onClick={() => setReplacementSourceId(null)}>Cancel</Button>
            <Button disabled={!replacementPreview.data?.data || replacementPreview.data.data.profiles.some(profile => !profile.targetHasQueue) || reassign.isPending}
              onClick={() => reassign.mutate()}>{reassign.isPending ? "Reassigning…" : "Reassign profiles for future jobs"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <div className="rounded border p-4"><h3 className="font-medium">Recent local copy jobs</h3>{(jobs.data?.data ?? []).map((job: any) => <p key={job.id} className="text-sm">{job.outputFilename}: {job.status}{job.lastError ? ` — ${job.lastError}` : ""}</p>)}</div>
      <p className="text-sm text-muted-foreground">Art Output Folder is configured per customer. Used by the optional local bridge agent to copy final production files to your local/network storage.</p>
    </div>
  );
}
