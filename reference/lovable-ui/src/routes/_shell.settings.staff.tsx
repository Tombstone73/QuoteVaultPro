import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Mail, UserPlus } from "lucide-react";
import { EmptyBlock, ReadyChip, SettingsPage } from "@/components/app/settings/shared";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { staff, type StaffState } from "@/lib/mock/settings";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_shell/settings/staff")({
  head: () => ({
    meta: [
      { title: "Staff & Users — PrintersHero V2 Settings" },
      { name: "description", content: "Invite staff, assign permission sets and manage access for everyone who works in your shop." },
      { property: "og:title", content: "Staff & Users — PrintersHero V2 Settings" },
      { property: "og:description", content: "Who works in PrintersHero and what they can reach." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: StaffPage,
});

const STATE_CLS: Record<StaffState, string> = {
  Active: "text-ok border-ok bg-ok/20",
  "Invitation pending": "text-warn border-warn bg-warn/20",
  Disabled: "text-muted-foreground border-border bg-transparent",
};

function StaffPage() {
  const [disable, setDisable] = useState<string | null>(null);
  const target = staff.find((s) => s.id === disable);

  return (
    <SettingsPage
      title="Staff & Users"
      description="Access is granted through permission sets, not individual toggles."
      actions={<Button size="sm" className="h-8 gap-1.5 text-[12px]"><UserPlus className="size-3.5" /> Invite staff</Button>}
    >
      <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
        <ReadyChip state="ready" label={`${staff.filter((s) => s.state === "Active").length} active`} />
        <span>1 invitation pending · 1 disabled</span>
      </div>

      <div className="panel overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-surface-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2">Person</th>
              <th className="hidden px-3 py-2 sm:table-cell">Access</th>
              <th className="px-3 py-2">Status</th>
              <th className="hidden px-3 py-2 lg:table-cell">Last activity</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {staff.map((s) => (
              <tr key={s.id} className="text-[13px]">
                <td className="px-3 py-2">
                  <div className="font-medium">{s.name}</div>
                  <div className="text-[11px] text-muted-foreground">{s.email}</div>
                </td>
                <td className="hidden px-3 py-2 sm:table-cell">{s.set}</td>
                <td className="px-3 py-2">
                  <span className={cn("inline-flex whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[11px] font-medium", STATE_CLS[s.state])}>
                    {s.state}
                  </span>
                </td>
                <td className="hidden px-3 py-2 text-[12px] text-muted-foreground lg:table-cell">{s.lastActive}</td>
                <td className="px-3 py-2">
                  <div className="flex justify-end gap-1.5">
                    {s.state === "Invitation pending" && (
                      <Button size="sm" variant="outline" className="h-7 gap-1 text-[12px]"><Mail className="size-3.5" /> Resend</Button>
                    )}
                    <Button size="sm" variant="outline" className="h-7 text-[12px]">Edit access</Button>
                    {s.state !== "Disabled" && (
                      <Button size="sm" variant="ghost" className="h-7 text-[12px] text-late hover:text-late" onClick={() => setDisable(s.id)}>
                        Disable
                      </Button>
                    )}
                    {s.state === "Disabled" && <Button size="sm" variant="ghost" className="h-7 text-[12px]">Re-enable</Button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <EmptyBlock
        title="No additional staff members have been invited"
        body="Invited people receive an email and choose their own password. Their access comes from the permission set you assign, and you can change it at any time."
        action={<Button size="sm" className="h-8 gap-1.5 text-[12px]"><UserPlus className="size-3.5" /> Invite staff</Button>}
      />

      <Dialog open={disable !== null} onOpenChange={(o) => !o && setDisable(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disable {target?.name}?</DialogTitle>
            <DialogDescription>
              They will be signed out and will not be able to sign back in. Their history, notes and completed work are kept, and
              you can re-enable them later.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setDisable(null)}>Cancel</Button>
            <Button variant="destructive" size="sm" onClick={() => setDisable(null)}>Disable access</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsPage>
  );
}
