import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { bridgeConnectionLabel, type BridgeConnectionHealth } from "@shared/printBridgeConnection";

export function PrintBridgeConnection({ status, connectionHealth }: { status: string; connectionHealth?: BridgeConnectionHealth | null }) {
  return <div className="text-sm" role="status">
    <p className="font-medium">{bridgeConnectionLabel(status, connectionHealth)}</p>
    <p className="text-xs text-muted-foreground">Last heartbeat: {connectionHealth?.reportedAt ? new Date(connectionHealth.reportedAt).toLocaleString() : "Not reported"}</p>
    {connectionHealth?.error && <p>{connectionHealth.error === "pairing_required" ? "Pairing required: run setup-agent.cmd on the workstation."
      : connectionHealth.error === "api_unavailable" ? "API unavailable: check workstation connectivity and configured API host."
      : "Wake channel unavailable: the agent is reconnecting automatically."}</p>}
  </div>;
}

export function PrintBridgeRecovery() {
  const [open, setOpen] = useState(false);
  const [feedback, setFeedback] = useState("");
  const command = ".\\scripts\\manage-agent-task.ps1 -Action restart";
  return <>
    <Button size="sm" variant="outline" onClick={() => setOpen(true)}>Restart Bridge Service…</Button>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent>
      <DialogHeader><DialogTitle>Restart Bridge Service locally</DialogTitle>
        <DialogDescription>The browser cannot control a Windows service. The Print Agent uses the existing signed-in user's scheduled task.</DialogDescription></DialogHeader>
      <ol className="list-decimal space-y-2 pl-5 text-sm">
        <li>On the paired workstation, use the PrintersHero tray icon → Restart Bridge Service (agent 1.0.29 or newer).</li>
        <li>If the tray icon is missing, open PowerShell in the extracted Print Agent folder and run:</li>
      </ol>
      <code className="break-all rounded bg-muted p-2 text-sm">{command}</code>
      <Button variant="outline" onClick={async () => { try { await navigator.clipboard.writeText(command); setFeedback("Command copied. Run it on the paired workstation; no restart has been requested by this browser."); } catch { setFeedback("Copy unavailable. Select the command above and copy it manually."); } }}>Copy local restart command</Button>
      <p className="text-sm">If the task/controller is missing, extract the complete package and run <code>setup-agent.cmd</code>. Cloud updates do not update installed agents.</p>
      <p className="text-sm">Wait for active printing to finish. A claimed job with uncertain paper output needs operator review; reconnect never retries claimed or completed jobs.</p>
      {feedback && <p role="status" className="text-sm">{feedback}</p>}
    </DialogContent></Dialog>
  </>;
}
