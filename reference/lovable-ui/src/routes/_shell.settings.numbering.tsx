import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Lock, Pencil, TriangleAlert } from "lucide-react";
import { AuditLine, ReadyChip, Row, SaveBar, Section, SettingsPage } from "@/components/app/settings/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { numbering } from "@/lib/mock/settings";

export const Route = createFileRoute("/_shell/settings/numbering")({
  head: () => ({
    meta: [
      { title: "Numbering — PrintersHero V2 Settings" },
      { name: "description", content: "Prefixes and next numbers for quotes, orders and invoices. Changes affect future records only." },
      { property: "og:title", content: "Numbering — PrintersHero V2 Settings" },
      { property: "og:description", content: "Safe, explicit control over document numbering." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: NumberingPage,
});

function NumberingPage() {
  const [editing, setEditing] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const target = numbering.find((n) => n.id === confirm);

  return (
    <SettingsPage
      title="Numbering"
      description="Numbers are allocated when a document is created. Changing them never renumbers existing documents."
      actions={<ReadyChip state="ready" />}
    >
      <div className="flex items-start gap-2 rounded-lg border border-warn/50 bg-warn/10 px-3 py-2.5 text-[12px]">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
        <span>Changes affect future numbers only. Existing documents are not renumbered. Lowering a next number can cause duplicates.</span>
      </div>

      {numbering.map((n) => {
        const unlocked = editing === n.id;
        return (
          <Section
            key={n.id}
            title={n.label}
            action={
              n.protected && !unlocked ? (
                <Button size="sm" variant="outline" className="h-7 gap-1.5 text-[12px]" onClick={() => setConfirm(n.id)}>
                  <Lock className="size-3.5" /> Edit numbering
                </Button>
              ) : !n.protected && !unlocked ? (
                <Button size="sm" variant="outline" className="h-7 gap-1.5 text-[12px]" onClick={() => setEditing(n.id)}>
                  <Pencil className="size-3.5" /> Edit
                </Button>
              ) : (
                <Button size="sm" variant="ghost" className="h-7 text-[12px]" onClick={() => setEditing(null)}>Done</Button>
              )
            }
          >
            <div className="grid gap-3 sm:grid-cols-3">
              <Row label="Prefix">
                <Input className="h-8 text-[13px]" defaultValue={n.prefix} disabled={!unlocked} placeholder="None" />
              </Row>
              <Row label="Next number" hint={unlocked ? "This number will be used by the next document created." : undefined}>
                <Input className="num h-8 text-[13px]" defaultValue={String(n.next)} disabled={!unlocked} />
              </Row>
              <Row label="Example">
                <div className="num flex h-8 items-center rounded-md border border-border bg-surface-2 px-2 text-[13px]">{n.example}</div>
              </Row>
            </div>
            <AuditLine>Last changed {n.updated}</AuditLine>
          </Section>
        );
      })}

      <SaveBar note="Numbering changes are recorded in the organization history." />

      <Dialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Unlock {target?.label.toLowerCase()} numbering?</DialogTitle>
            <DialogDescription>
              {target?.label} numbers are protected because they appear on commercial documents. Unlocking lets you change the
              prefix and the next number. Existing documents keep their numbers, and duplicate numbers can result if you lower
              the next number.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setConfirm(null)}>Cancel</Button>
            <Button size="sm" onClick={() => { setEditing(confirm); setConfirm(null); }}>Unlock and edit</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsPage>
  );
}
