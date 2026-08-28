import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Mail, RefreshCw, Unplug } from "lucide-react";
import { AuditLine, EmptyBlock, PermissionNotice, ReadyChip, Section, SettingsPage } from "@/components/app/settings/shared";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { emailDelivery } from "@/lib/mock/settings";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_shell/settings/email")({
  head: () => ({
    meta: [
      { title: "Email Delivery — PrintersHero V2 Settings" },
      { name: "description", content: "Connect the Gmail account PrintersHero uses to send customer documents such as quotes." },
      { property: "og:title", content: "Email Delivery — PrintersHero V2 Settings" },
      { property: "og:description", content: "Your organization's sending account and its readiness." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: EmailPage,
});

type State = "ready" | "not-configured" | "reconnect" | "error";

const STATES: { id: State; label: string }[] = [
  { id: "ready", label: "Connected" },
  { id: "reconnect", label: "Reconnect required" },
  { id: "error", label: "Error" },
  { id: "not-configured", label: "Not configured" },
];

function EmailPage() {
  const [state, setState] = useState<State>("ready");
  const [disconnect, setDisconnect] = useState(false);
  const [denied, setDenied] = useState(false);

  return (
    <SettingsPage
      title="Email Delivery"
      description="PrintersHero uses this account to send customer documents such as quotes. Messages come from your own address, so replies go straight back to you."
      actions={<ReadyChip state={state} />}
    >
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-border bg-surface-2/40 px-3 py-2 text-[11px] text-muted-foreground">
        <span className="font-medium uppercase tracking-wide">Reference states</span>
        {STATES.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setState(s.id)}
            className={cn("rounded border border-border px-1.5 py-0.5", state === s.id && "border-primary text-primary")}
          >
            {s.label}
          </button>
        ))}
        <button type="button" onClick={() => setDenied((d) => !d)} className={cn("rounded border border-border px-1.5 py-0.5", denied && "border-primary text-primary")}>
          No permission
        </button>
      </div>

      {denied && <PermissionNotice what="Email delivery needs attention." />}

      <Section title="Sending account">
        {state === "not-configured" ? (
          <EmptyBlock
            title="No sending account is connected"
            body="Quotes and other customer documents cannot be emailed until a Gmail account is connected. Connecting takes about a minute and can be changed later."
            action={<Button size="sm" className="h-8 gap-1.5 text-[12px]" disabled={denied}><Mail className="size-3.5" /> Connect Gmail</Button>}
          />
        ) : (
          <div className="panel space-y-3 p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Provider</div>
                <div className="text-[13px] font-semibold">{emailDelivery.provider}</div>
                <div className="mt-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Sending as</div>
                <div className="text-[13px]">{emailDelivery.sender}</div>
              </div>
              <div className="flex flex-col items-end gap-2">
                <ReadyChip state={state} />
                <div className="flex gap-2">
                  {(state === "reconnect" || state === "error") && (
                    <Button size="sm" className="h-8 gap-1.5 text-[12px]" disabled={denied}><RefreshCw className="size-3.5" /> Reconnect</Button>
                  )}
                  <Button size="sm" variant="outline" className="h-8 gap-1.5 text-[12px]" disabled={denied} onClick={() => setDisconnect(true)}>
                    <Unplug className="size-3.5" /> Disconnect
                  </Button>
                </div>
              </div>
            </div>

            {state === "reconnect" && (
              <p className="rounded-md border border-warn/50 bg-warn/10 px-3 py-2 text-[12px]">
                Google needs you to approve sending again. Quotes cannot be emailed until you reconnect.
              </p>
            )}
            {state === "error" && (
              <p className="rounded-md border border-late/50 bg-late/10 px-3 py-2 text-[12px]">
                The last send attempt was rejected by Google. Reconnect the account, or use a different Gmail address.
              </p>
            )}
            {state === "ready" && (
              <p className="text-[12px] text-muted-foreground">Last checked {emailDelivery.lastValidated}.</p>
            )}
          </div>
        )}
      </Section>

      {state !== "not-configured" && (
        <Section title="Recent activity">
          <ul className="divide-y divide-border">
            {emailDelivery.history.map((h) => (
              <li key={h.at} className="flex items-center justify-between py-1.5 text-[12px]">
                <span>{h.what}</span>
                <span className="text-muted-foreground">{h.at}</span>
              </li>
            ))}
          </ul>
          <AuditLine>PrintersHero never displays or stores your Google password.</AuditLine>
        </Section>
      )}

      <Dialog open={disconnect} onOpenChange={setDisconnect}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disconnect {emailDelivery.sender}?</DialogTitle>
            <DialogDescription>
              Quotes and other customer documents will no longer be emailable until another account is connected. Documents that
              were already sent are unaffected.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setDisconnect(false)}>Cancel</Button>
            <Button variant="destructive" size="sm" onClick={() => { setState("not-configured"); setDisconnect(false); }}>Disconnect</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsPage>
  );
}
