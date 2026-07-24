import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useState } from "react";

type KnowledgeDocument = { id: string; title: string; category: string; status: string; sourceVersion: string; sourceType: string; indexedAt: string | null; organizationId: string | null };
async function getKnowledge() { const res = await fetch("/api/ai/knowledge", { credentials: "include" }); if (!res.ok) throw new Error("Unable to load knowledge"); return res.json() as Promise<{ data: KnowledgeDocument[]; status: { documents: number; active: number; chunks: number; lastSyncAt: string | null } }>; }

export default function AiKnowledgePage() {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const knowledge = useQuery({ queryKey: ["/api/ai/knowledge"], queryFn: getKnowledge });
  const sync = useMutation({ mutationFn: async () => { const res = await fetch("/api/ai/knowledge/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dryRun: false }), credentials: "include" }); if (!res.ok) throw new Error("Knowledge sync failed"); return res.json(); }, onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/ai/knowledge"] }) });
  const documents = (knowledge.data?.data ?? []).filter((document) => !query || `${document.title} ${document.category}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="space-y-6">
    <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><BookOpen className="h-4 w-4" />Knowledge Center</CardTitle></CardHeader><CardContent className="space-y-3 text-sm text-muted-foreground"><p>Repository-managed System Guide articles are versioned, searchable, and source controlled. Tenant-specific knowledge remains isolated.</p><div className="flex flex-wrap gap-2"><Badge variant="outline">{knowledge.data?.status.documents ?? 0} documents</Badge><Badge variant="outline">{knowledge.data?.status.chunks ?? 0} chunks</Badge><Button size="sm" onClick={() => sync.mutate()} disabled={sync.isPending}><RefreshCw className="mr-2 h-3.5 w-3.5" />{sync.isPending ? "Syncing…" : "Sync approved corpus"}</Button></div></CardContent></Card>
    <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search indexed knowledge" aria-label="Search knowledge" />
    <div className="space-y-2">{documents.map((document) => <Card key={document.id}><CardContent className="flex items-center justify-between gap-3 p-4"><div><div className="font-medium">{document.title}</div><div className="text-xs text-muted-foreground">{document.category} · {document.sourceVersion} · {document.organizationId ? "Organization" : "PrintersHero"}</div></div><Badge variant={document.status === "active" ? "default" : "secondary"}>{document.status}</Badge></CardContent></Card>)}{!knowledge.isLoading && !documents.length ? <p className="text-sm text-muted-foreground">No indexed knowledge matches this filter.</p> : null}</div>
  </div>;
}
