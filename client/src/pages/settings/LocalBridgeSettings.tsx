import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { readJson } from "@/lib/queryClient";

export default function LocalBridgeSettings() {
  const queryClient = useQueryClient(); const [name, setName] = useState("Shop Local Bridge"); const [token, setToken] = useState<string | null>(null);
  const agents = useQuery({ queryKey: ["/api/local-bridge/admin/agents"], queryFn: () => readJson<any>("/api/local-bridge/admin/agents") });
  const jobs = useQuery({ queryKey: ["/api/local-bridge/admin/jobs"], queryFn: () => readJson<any>("/api/local-bridge/admin/jobs") });
  const create = useMutation({ mutationFn: () => readJson<any>("/api/local-bridge/admin/agents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }), onSuccess: (r) => { setToken(r.data.token); queryClient.invalidateQueries({ queryKey: ["/api/local-bridge/admin/agents"] }); } });
  const revoke = useMutation({ mutationFn: (id: string) => readJson(`/api/local-bridge/admin/agents/${id}/revoke`, { method: "POST" }), onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/local-bridge/admin/agents"] }) });
  const list = agents.data?.data ?? []; const latest = list[0]; const online = latest?.lastSeenAt && Date.now() - new Date(latest.lastSeenAt).getTime() < 5 * 60_000;
  return <div className="space-y-6"><div><h2 className="text-xl font-semibold">Local Bridge</h2><p className="text-sm text-muted-foreground">Optional outbound bridge for customer art-folder copies. The cloud backend never writes directly to your network.</p></div><div className="rounded border p-4 space-y-3"><p>Status: <b>{!latest ? "Not configured" : latest.status === "revoked" ? "Disabled/revoked" : !latest.lastSeenAt ? "Waiting for heartbeat" : online ? "Online" : "Offline"}</b></p><Input value={name} onChange={e => setName(e.target.value)} /><Button onClick={() => create.mutate()} disabled={create.isPending}>Create bridge token</Button>{token && <div className="rounded bg-amber-50 p-3 text-sm break-all">Copy this token now; it will not be shown again: <code>{token}</code></div>}{list.map((agent: any) => <div key={agent.id} className="flex justify-between border-t pt-2"><span>{agent.name} — {agent.status}</span><Button variant="destructive" size="sm" onClick={() => revoke.mutate(agent.id)}>Revoke</Button></div>)}</div><div className="rounded border p-4"><h3 className="font-medium">Recent local copy jobs</h3>{(jobs.data?.data ?? []).map((job: any) => <p key={job.id} className="text-sm">{job.outputFilename}: {job.status}{job.lastError ? ` — ${job.lastError}` : ""}</p>)}</div><p className="text-sm text-muted-foreground">Art Output Folder is configured per customer. Used by the optional local bridge agent to copy final production files to your local/network storage.</p></div>;
}
