import { useRef, useState } from "react";
import { useActiveOrganizationRole } from "@/hooks/useActiveOrganizationRole";
import { useFilePrefixToolsStatus } from "@/hooks/useFilePrefixToolsStatus";
import { apiUrl } from "@/lib/apiConfig";
import { apiFetch } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type PlanEntry = { originalName: string; proposedName: string; status: string; reason?: string };
type ApprovedPlan = { prefix: string; entries: PlanEntry[]; authorizationToken: string };
type RenameResult = { originalName: string; proposedName: string; status: "renamed" | "skipped" | "failed"; reason?: string };

function downloadJson(filename: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export default function BulkFileRenamerPage() {
  const { activeOrgId } = useActiveOrganizationRole();
  const status = useFilePrefixToolsStatus(activeOrgId);
  const fileInput = useRef<HTMLInputElement>(null);
  const resultsInput = useRef<HTMLInputElement>(null);
  const [prefix, setPrefix] = useState("");
  const [filenames, setFilenames] = useState<string[]>([]);
  const [entries, setEntries] = useState<PlanEntry[]>([]);
  const [plan, setPlan] = useState<ApprovedPlan | null>(null);
  const [results, setResults] = useState<RenameResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const preview = async () => {
    setBusy(true);
    setError(null);
    setPlan(null);
    try {
      const response = await apiFetch("/api/tools/bulk-file-renamer/plan", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prefix, filenames }),
      });
      const payload = await response.json();
      setEntries(Array.isArray(payload.entries) ? payload.entries : []);
      if (!response.ok) throw new Error(payload.error || "The rename plan could not be approved.");
      setPlan(payload);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The rename plan could not be approved.");
    } finally {
      setBusy(false);
    }
  };

  const exportPlan = () => {
    if (!plan) return;
    downloadJson("printershero-rename-plan.json", {
      version: 1,
      prefix: plan.prefix,
      entries: plan.entries,
      authorizationToken: plan.authorizationToken,
      authorizationUrl: new URL(apiUrl("/api/tools/bulk-file-renamer/authorize"), window.location.origin).toString(),
    });
  };

  const loadResults = async (file?: File) => {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (!Array.isArray(parsed.results) || !parsed.results.every((result: any) =>
        typeof result.originalName === "string" && typeof result.proposedName === "string" &&
        ["renamed", "skipped", "failed"].includes(result.status))) throw new Error("Invalid results file.");
      setResults(parsed.results);
      setError(null);
    } catch {
      setError("The selected results file is invalid.");
    }
  };

  if (status.isLoading) return <main className="p-6">Loading Bulk File Renamer…</main>;
  if (!status.data?.enabled) return <main className="p-6">Bulk File Renamer is disabled for this organization.</main>;

  return <main className="mx-auto max-w-5xl space-y-5 p-4 md:p-6">
    <div><h1 className="text-2xl font-semibold">Bulk File Renamer</h1>
      <p className="text-sm text-muted-foreground">Preview names here, then run the approved plan with the Windows helper. Files stay in their original folders and are never uploaded.</p></div>
    <div className="space-y-4 rounded-lg border p-4">
      <div className="space-y-1"><Label htmlFor="rename-prefix">Prefix text</Label>
        <Input id="rename-prefix" value={prefix} onChange={(event) => { setPrefix(event.target.value); setPlan(null); setEntries([]); }} placeholder="20685" maxLength={100} /></div>
      <input ref={fileInput} type="file" multiple className="hidden" onChange={(event) => {
        setFilenames(Array.from(event.target.files ?? [], (file) => file.name)); setPlan(null); setEntries([]);
      }} />
      <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => fileInput.current?.click()}>Select Files</Button>
        <Button onClick={preview} disabled={busy || !prefix || filenames.length === 0}>Preview Names</Button></div>
      <p className="text-sm text-muted-foreground">{filenames.length} file{filenames.length === 1 ? "" : "s"} selected. Only filenames are sent for approval.</p>
    </div>
    {entries.length > 0 && <div className="space-y-3 rounded-lg border p-4">
      <h2 className="font-semibold">Rename preview</h2>
      <div className="overflow-x-auto"><table className="w-full min-w-[32rem] text-left text-sm"><thead><tr><th className="p-2">Original</th><th className="p-2">Proposed</th><th className="p-2">Status</th></tr></thead>
        <tbody>{entries.map((entry, index) => <tr key={index} className="border-t"><td className="p-2 break-all">{entry.originalName}</td><td className="p-2 break-all">{entry.proposedName}</td><td className="p-2">{entry.reason || entry.status}</td></tr>)}</tbody></table></div>
      <p className="text-sm text-muted-foreground">Review every name. Rename Files downloads a plan valid for 30 minutes. Open the Python 3 helper, choose that plan and the matching local files, then confirm. The helper writes results and an undo manifest beside the plan.</p>
      <div className="flex flex-wrap gap-2"><Button onClick={exportPlan} disabled={!plan}>Rename Files</Button>
        <Button variant="outline" asChild><a href={apiUrl("/api/tools/bulk-file-renamer/helper")} download>Download Windows Python helper</a></Button></div>
    </div>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <div className="space-y-3 rounded-lg border p-4"><h2 className="font-semibold">Results</h2>
      <p className="text-sm text-muted-foreground">Import the helper's results file to review renamed, skipped, and failed files here. Safe undo is available in the helper using its undo manifest.</p>
      <input ref={resultsInput} type="file" accept=".json,application/json" className="hidden" onChange={(event) => void loadResults(event.target.files?.[0])} />
      <Button variant="outline" onClick={() => resultsInput.current?.click()}>Open Results</Button>
      {results.length > 0 && <div className="space-y-1 text-sm">{results.map((result, index) => <p key={index}>{result.status}: {result.originalName} → {result.proposedName}{result.reason ? ` — ${result.reason}` : ""}</p>)}</div>}
    </div>
  </main>;
}
