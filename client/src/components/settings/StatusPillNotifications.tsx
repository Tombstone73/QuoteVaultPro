import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { OrderStatusPill } from "@/hooks/useOrderStatusPills";
import {
  renderStatusNotification, statusNotificationKinds, statusNotificationLabels,
  statusNotificationRulesSchema, statusNotificationTemplateLabels,
  type StatusNotificationKind, type StatusNotificationRules,
} from "@shared/statusNotifications";

const customerTemplates = ["order_update", "order_activity"] as const;
const staffTemplates = ["staff_status", "staff_review"] as const;

export function StatusPillNotifications({ pill }: { pill: OrderStatusPill }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button type="button" size="sm" variant="outline" aria-label={`Notifications for ${pill.name}`}>Notifications</Button></DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Notifications for {pill.name}</DialogTitle>
          <DialogDescription>
            Rules run when an order enters this status. A subsequent status change cancels notifications that have not started dispatch. A delay of 0 makes the rule eligible immediately.
          </DialogDescription>
        </DialogHeader>
        {open && <NotificationRulesForm pill={pill} onSaved={() => setOpen(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function NotificationRulesForm({ pill, onSaved }: { pill: OrderStatusPill; onSaved: () => void }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(() => statusNotificationRulesSchema.parse(pill.notificationRules ?? {}));
  const save = useMutation({
    mutationFn: async (rules: StatusNotificationRules) => {
      const result = await fetch(`/api/settings/order-status-pills/${pill.id}/notifications`, {
        method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(rules),
      });
      const data = await result.json();
      if (!result.ok) throw new Error(data.message || "Unable to save notifications.");
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api", "orders", "status-pills"] });
      onSaved();
    },
  });
  const valid = statusNotificationRulesSchema.safeParse(draft).success && statusNotificationKinds.every(kind =>
    !draft[kind].enabled || (pill.isActive && pill.notificationTriggerEligible && (kind === "staff_email" || pill.customerVisible)));
  const patch = (kind: StatusNotificationKind, updates: Partial<StatusNotificationRules[StatusNotificationKind]>) => {
    setDraft(previous => ({ ...previous, [kind]: { ...previous[kind], ...updates } }));
  };
  return (
    <form className="space-y-3" onSubmit={event => { event.preventDefault(); if (valid) save.mutate(draft); }}>
      {!pill.isActive || !pill.notificationTriggerEligible ? <p className="text-sm text-muted-foreground">Save the status as active and notification eligible to enable a rule.</p> : null}
      {statusNotificationKinds.map(kind => {
        const rule = draft[kind];
        const label = statusNotificationLabels[kind];
        const staff = kind === "staff_email";
        const available = pill.isActive && pill.notificationTriggerEligible && (staff || pill.customerVisible);
        const templateOptions = staff ? staffTemplates : customerTemplates;
        const preview = renderStatusNotification(rule.template, "20507", pill.name);
        return (
          <fieldset className="space-y-2 rounded-md border p-3" key={kind}>
            <legend className="px-1 text-sm font-medium">{label}</legend>
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor={`${kind}-enabled`}>Send when entering this status</Label>
              <Switch id={`${kind}-enabled`} checked={rule.enabled} disabled={!available && !rule.enabled}
                onCheckedChange={enabled => patch(kind, { enabled })} />
            </div>
            {!staff && !pill.customerVisible && <p className="text-xs text-muted-foreground">Save Customer visible on this status to enable this rule.</p>}
            {rule.enabled && <>
              <div className="grid items-end gap-2 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor={`${kind}-delay`}>Delay in seconds</Label>
                  <Input id={`${kind}-delay`} type="number" min={0} max={604800} step={1} required
                    value={Number.isNaN(rule.delaySeconds) ? "" : rule.delaySeconds}
                    onChange={event => patch(kind, { delaySeconds: event.currentTarget.valueAsNumber })} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`${kind}-template`}>Template</Label>
                  <Select value={rule.template} onValueChange={template => patch(kind, { template: template as typeof rule.template })}>
                    <SelectTrigger id={`${kind}-template`}><SelectValue /></SelectTrigger>
                    <SelectContent>{templateOptions.map(key => <SelectItem key={key} value={key}>{statusNotificationTemplateLabels[key]}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              {staff ? <div className="space-y-1">
                <Label htmlFor="staff-status-recipients">Recipients</Label>
                <Select value={draft.staff_email.recipients} onValueChange={recipients => patch(kind, { recipients: recipients as StatusNotificationRules["staff_email"]["recipients"] })}>
                  <SelectTrigger id="staff-status-recipients"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="administrators">Organization owners and admins</SelectItem>
                    <SelectItem value="order_creator">Order creator, if an owner or admin</SelectItem>
                  </SelectContent>
                </Select>
              </div> : <p className="text-xs text-muted-foreground">
                {kind === "customer_email" ? "Recipient: order contact, or the customer email when the order has no contact."
                  : "Recipient: the order’s customer account in portal Recent Activity when portal access is active."}
              </p>}
              <div className="rounded-md bg-muted p-2 text-sm" aria-label={`${label} preview`}>
                <div className="text-xs text-muted-foreground">Preview</div>
                <div className="font-medium">{preview.subject}</div>
                <div>{preview.body}</div>
              </div>
            </>}
          </fieldset>
        );
      })}
      {save.error && <p role="alert" className="text-sm text-destructive">{save.error.message}</p>}
      <div className="flex justify-end"><Button type="submit" disabled={!valid || save.isPending}>{save.isPending ? "Saving…" : "Save notifications"}</Button></div>
    </form>
  );
}
