import { useRouterState } from "@tanstack/react-router";
import { toast } from "sonner";
import { useApp } from "@/lib/app-store";
import { CURRENT_USER } from "@/lib/mock/data";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

export function BugDialog() {
  const { bugOpen, setBugOpen } = useApp();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <Dialog open={bugOpen} onOpenChange={setBugOpen}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Report a Problem</DialogTitle>
          <DialogDescription>Context is attached automatically. Just tell us what happened.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="bug-title">What went wrong?</Label>
            <Input id="bug-title" placeholder="Short summary" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="bug-desc">Details</Label>
            <Textarea id="bug-desc" rows={4} placeholder="What did you expect, and what happened instead?" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Severity</Label>
              <Select defaultValue="Medium">
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["Low", "Medium", "High", "Blocking"].map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Category</Label>
              <Select defaultValue="UI">
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["UI", "Pricing", "Artwork", "Production", "Billing", "Integration"].map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button variant="outline" size="sm" className="justify-start">Attach screenshot</Button>

          <div className="rounded-md border border-border bg-surface-2 p-2.5 text-[11px] text-muted-foreground">
            <div className="mb-1 font-semibold uppercase tracking-wide">Attached automatically</div>
            <div className="num grid grid-cols-2 gap-x-4 gap-y-0.5">
              <span>Page: {pathname}</span>
              <span>User: {CURRENT_USER.name}</span>
              <span>Org: {CURRENT_USER.org}</span>
              <span>Version: v2.0.0-preview.14</span>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setBugOpen(false)}>Cancel</Button>
          <Button
            onClick={() => { setBugOpen(false); toast.success("Problem reported", { description: "Ticket BUG-1042 created with page context." }); }}
          >
            Send Report
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
