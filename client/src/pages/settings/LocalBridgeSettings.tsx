import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiUrl } from "@/lib/apiConfig";
import { apiFetch, apiRequest } from "@/lib/queryClient";

async function readJson<T>(url: string): Promise<T> { const response = await apiFetch(url); if (!response.ok) throw new Error(await response.text()); return response.json() as Promise<T>; }

// These must target the deployment's API origin, not the Vercel web host.
// The endpoints retain their existing authenticated Local Bridge admin middleware.
const travelerAgentDownloadUrl = apiUrl("/api/local-bridge/admin/traveler-print-agent-package");
const legacyBridgeAgentDownloadUrl = apiUrl("/api/local-bridge/admin/agent-package");

function isAgentOnline(agent: any) {
  return Boolean(agent.machineLabel && agent.configuredTravelerPrinterName && agent.lastSeenAt && Date.now() - new Date(agent.lastSeenAt).getTime() < 5 * 60_000);
}

export default function LocalBridgeSettings() {
  const queryClient = useQueryClient();
  const [name, setName] = useState("Shop Local Bridge");
  const [token, setToken] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const agents = useQuery({ queryKey: ["/api/local-bridge/admin/agents"], queryFn: () => readJson<any>("/api/local-bridge/admin/agents") });
  const jobs = useQuery({ queryKey: ["/api/local-bridge/admin/jobs"], queryFn: () => readJson<any>("/api/local-bridge/admin/jobs") });
  const create = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/local-bridge/admin/agents", { name })).json() as Promise<any>,
    onSuccess: (result: any) => {
      setToken(result.data.token);
      queryClient.invalidateQueries({ queryKey: ["/api/local-bridge/admin/agents"] });
    },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/local-bridge/admin/agents/${id}/revoke`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/local-bridge/admin/agents"] }),
  });
  const activeAgents = (agents.data?.data ?? []).filter((agent: any) => agent.status === "active");
  const onlineAgentCount = activeAgents.filter(isAgentOnline).length;
  const status = !activeAgents.length
    ? "No active agents"
    : `${onlineAgentCount} of ${activeAgents.length} active agent${activeAgents.length === 1 ? "" : "s"} online`;
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
        <h3 className="font-medium">Traveler Print Agent</h3>
        <p className="text-sm text-muted-foreground">Download the self-contained Windows agent used to print Travelers to a configured local printer. It includes the .NET runtime; WebView2 and the printer driver remain workstation requirements.</p>
        <Button asChild><a href={travelerAgentDownloadUrl}>Download Traveler Print Agent</a></Button>
        <ol className="list-decimal pl-5 text-sm"><li>Extract the ZIP to a stable local folder on the print workstation.</li><li>Run setup-agent.cmd.</li><li>Select the Traveler printer and paste a newly created pairing token.</li><li>Confirm this page shows Online.</li></ol>
      </div>
      <div className="space-y-2 rounded border p-4">
        <h3 className="font-medium">Legacy Local Bridge Agent</h3>
        <p className="text-sm text-muted-foreground">This small Node.js agent copies customer artwork to local folders. It does not print Travelers.</p>
        <Button variant="outline" asChild><a href={legacyBridgeAgentDownloadUrl}>Download Legacy Local Bridge Agent</a></Button>
        <ol className="list-decimal pl-5 text-sm"><li>Download and extract the bridge package.</li><li>Run it on a shop PC or server.</li><li>Enter the API base URL and bridge token.</li><li>Confirm this page shows Online.</li></ol>
      </div>
      <div className="space-y-3 rounded border p-4">
        <p>Print agent status: <b>{status}</b></p>
        <Input value={name} onChange={(event) => setName(event.target.value)} aria-label="New agent name" placeholder="e.g. Front counter Epson TM-L90" />
        <Button onClick={() => create.mutate()} disabled={create.isPending}>Create bridge token</Button>
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
        {activeAgents.map((agent: any) => {
          const paired = Boolean(agent.machineLabel && agent.configuredTravelerPrinterName);
          const connection = !paired ? "Awaiting setup" : isAgentOnline(agent) ? "Online" : "Offline";
          return (
          <div key={agent.id} className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
            <div className="min-w-0 space-y-1">
              <p className="font-medium">{agent.name}</p>
              <p className="text-sm text-muted-foreground">Traveler printer: <span className="font-medium text-foreground">{agent.configuredTravelerPrinterName || "Not configured"}</span></p>
              <p className="text-sm text-muted-foreground">Workstation: {agent.machineLabel || "Not paired yet"} · <span className={connection === "Online" ? "font-medium text-emerald-700 dark:text-emerald-300" : "font-medium text-amber-700 dark:text-amber-300"}>{connection}</span></p>
            </div>
            <Button variant="destructive" size="sm" onClick={() => revoke.mutate(agent.id)}>Revoke</Button>
          </div>
          );
        })}
      </div>
      <div className="rounded border p-4"><h3 className="font-medium">Recent local copy jobs</h3>{(jobs.data?.data ?? []).map((job: any) => <p key={job.id} className="text-sm">{job.outputFilename}: {job.status}{job.lastError ? ` — ${job.lastError}` : ""}</p>)}</div>
      <p className="text-sm text-muted-foreground">Art Output Folder is configured per customer. Used by the optional local bridge agent to copy final production files to your local/network storage.</p>
    </div>
  );
}
