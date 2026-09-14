import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiFetch, apiRequest } from "@/lib/queryClient";

async function readJson<T>(url: string): Promise<T> { const response = await apiFetch(url); if (!response.ok) throw new Error(await response.text()); return response.json() as Promise<T>; }

export default function LocalBridgeSettings() {
  const queryClient = useQueryClient();
  const [name, setName] = useState("Shop Local Bridge");
  const [token, setToken] = useState<string | null>(null);
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
  const list = agents.data?.data ?? [];
  const latest = list[0];
  const online = latest?.lastSeenAt && Date.now() - new Date(latest.lastSeenAt).getTime() < 5 * 60_000;
  const status = !latest ? "Not configured" : latest.status === "revoked" ? "Disabled/revoked" : !latest.lastSeenAt ? "Waiting for heartbeat" : online ? "Online" : "Offline";
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Local Bridge</h2>
        <p className="text-sm text-muted-foreground">Optional outbound bridge for customer art-folder copies. The cloud backend never writes directly to your network.</p>
      </div>
      <div className="space-y-2 rounded border p-4">
        <h3 className="font-medium">Download Local Bridge Agent</h3>
        <p className="text-sm text-muted-foreground">Download the current bridge package. It runs on a shop PC or server inside your network.</p>
        <Button asChild><a href="/api/local-bridge/admin/agent-package">Download Local Bridge Agent</a></Button>
        <ol className="list-decimal pl-5 text-sm"><li>Download and extract the bridge package.</li><li>Run it on a shop PC or server.</li><li>Enter the API base URL and bridge token.</li><li>Confirm this page shows Online.</li></ol>
      </div>
      <div className="space-y-3 rounded border p-4">
        <p>Status: <b>{status}</b></p>
        <Input value={name} onChange={(event) => setName(event.target.value)} />
        <Button onClick={() => create.mutate()} disabled={create.isPending}>Create bridge token</Button>
        {token ? (
          <div className="break-all rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100" role="status" aria-live="polite">
            Copy this token now; it will not be shown again: <code className="font-mono font-medium">{token}</code>
          </div>
        ) : null}
        {list.map((agent: any) => (
          <div key={agent.id} className="flex flex-wrap items-center justify-between gap-3 border-t pt-2">
            <span>{agent.name} — {agent.status}</span>
            <Button variant="destructive" size="sm" onClick={() => revoke.mutate(agent.id)}>Revoke</Button>
          </div>
        ))}
      </div>
      <div className="rounded border p-4"><h3 className="font-medium">Recent local copy jobs</h3>{(jobs.data?.data ?? []).map((job: any) => <p key={job.id} className="text-sm">{job.outputFilename}: {job.status}{job.lastError ? ` — ${job.lastError}` : ""}</p>)}</div>
      <p className="text-sm text-muted-foreground">Art Output Folder is configured per customer. Used by the optional local bridge agent to copy final production files to your local/network storage.</p>
    </div>
  );
}
