import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Lock, Pencil, ShieldAlert, TriangleAlert } from "lucide-react";
import { AuditLine, AuditLine as Audit, ReadyChip, Row, SaveBar, Section, SettingsPage } from "@/components/app/settings/shared";
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
      { name: "description", content: "Prefixes and next numbers for quotes and orders, plus the migration state of compatibility-managed invoice and purchase order numbering." },
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

  const v2 = numbering.filter((n) => n.owner === "v2");
  const legacy = numbering.filter((n) => n.owner === "legacy");

  return (
    <SettingsPage
      title="Numbering"
      description="Numbers are allocated when a document is created. Changing them never renumbers existing documents."
      actions={<ReadyChip state="migration" />}
    >
      <div className="flex items-start gap-2 rounded-lg border border-info/40 bg-info/10 px-3 py-2.5 text-[12px]">
        <ShieldAlert className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
        <div>
          <div className="font-medium">Quote and order numbering are managed by PrintersHero V2.</div>
          <p className="text-muted-foreground">
            Invoice and purchase order numbering still use the previous allocator until migration is completed. Existing
            numbers remain valid and documents continue to be created normally.
          </p>
        </div>
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-warn/50 bg-warn/10 px-3 py-2.5 text-[12px]">
        <Lock className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
        <div>
          <div className="font-medium">Owner-only setting</div>
          <p className="text-muted-foreground">Changing numbering affects future document allocation for the whole organization.</p>
        </div>
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-border bg-surface-2/50 px-3 py-2.5 text-[12px]">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span>Changes affect future numbers only. Existing documents are not renumbered. PrintersHero will reject a next number that conflicts with numbers already allocated.</span>
      </div>

      {v2.map((n) => {
        const unlocked = editing === n.id;
        return (
          <Section
            key={n.id}
            title={n.label}
            hint={n.note}
            action={
              !unlocked ? (
                <Button size="sm" variant="outline" className="h-7 gap-1.5 text-[12px]" onClick={() => setConfirm(n.id)}>
                  <Pencil className="size-3.5" /> Edit numbering
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

      <SaveBar note="Applies to quote and order numbering only." />

      <Section title="Compatibility managed" hint="These sequences are still allocated outside PrintersHero V2. They cannot be edited here until migration is completed.">
        <div className="grid gap-2">
          {legacy.map((n) => (
            <div key={n.id} className="panel flex flex-wrap items-start justify-between gap-3 p-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-semibold">{n.label}</span>
                  <ReadyChip state="migration" />
                </div>
                <p className="mt-1 text-[12px] text-muted-foreground">{n.note}</p>
                <Audit>Last observed {n.updated}</Audit>
              </div>
              <div className="text-right">
                <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Next number</div>
                <div className="num text-[13px] font-semibold">{n.example}</div>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Dialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Unlock {target?.label.toLowerCase()} numbering?</DialogTitle>
            <DialogDescription>
              {target?.label} numbers appear on commercial documents, so they are protected. Unlocking lets you change the
              prefix and the next number. Existing documents keep their numbers, and PrintersHero will reject a next number
              that conflicts with numbers already allocated.
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
