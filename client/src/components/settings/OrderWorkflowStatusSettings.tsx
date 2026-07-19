import * as React from "react";
import { Loader2, Save } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useOrderStatusPills, useUpdateStatusPill, type OrderStatusPill } from "@/hooks/useOrderStatusPills";
import {
  useUpdateWorkflowStatusPillMapping,
  useWorkflowStatusPillMappings,
  type WorkflowStatusPillMapping,
} from "@/hooks/useWorkflowStatusPillMappings";
import {
  orderStatusPillLifecycleMappingValues,
  type OrderStatusPillLifecycleMapping,
} from "@shared/schema";
import type { WorkflowStatusPillAssignmentSource } from "@shared/orderStatusWorkflowAutomation";

export function formatWorkflowTriggerLabel(triggerKey: string) {
  return triggerKey.replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

type PillDraft = Pick<
  OrderStatusPill,
  "name" | "color" | "category" | "lifecycleMapping" | "sortOrder" | "isActive" | "customerVisible" | "notificationTriggerEligible"
>;

function makePillDraft(pill: OrderStatusPill): PillDraft {
  return {
    name: pill.name,
    color: pill.color,
    category: pill.category ?? null,
    lifecycleMapping: pill.lifecycleMapping as OrderStatusPillLifecycleMapping | null,
    sortOrder: pill.sortOrder,
    isActive: pill.isActive,
    customerVisible: pill.customerVisible,
    notificationTriggerEligible: pill.notificationTriggerEligible,
  };
}

function StatusPillRow({ pill }: { pill: OrderStatusPill }) {
  const update = useUpdateStatusPill();
  const [draft, setDraft] = React.useState<PillDraft>(() => makePillDraft(pill));
  React.useEffect(() => setDraft(makePillDraft(pill)), [pill]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(makePillDraft(pill));

  return (
    <TableRow className={!draft.isActive ? "opacity-65" : undefined}>
      <TableCell className="min-w-[250px]">
        <div className="flex items-start gap-2">
          <input
            aria-label={`Color for ${pill.key}`}
            type="color"
            value={draft.color}
            onChange={(event) => setDraft((current) => ({ ...current, color: event.target.value }))}
            className="h-9 w-10 cursor-pointer rounded border border-titan-border-subtle bg-transparent p-1"
          />
          <div className="min-w-0 flex-1 space-y-1">
            <Input
              aria-label={`Label for ${pill.key}`}
              value={draft.name}
              onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
            />
            <div className="flex flex-wrap items-center gap-1.5">
              <code className="rounded bg-titan-bg-subtle px-1.5 py-0.5 text-[11px] text-titan-text-muted">{pill.key}</code>
              <Badge variant="outline" className="text-[10px]">Key is permanent</Badge>
              {pill.isDefault ? <Badge variant="secondary" className="text-[10px]">Default</Badge> : null}
            </div>
          </div>
        </div>
      </TableCell>
      <TableCell className="min-w-[230px]">
        <div className="grid gap-2">
          <Select
            value={draft.lifecycleMapping ?? "__none__"}
            onValueChange={(value) => setDraft((current) => ({
              ...current,
              lifecycleMapping: value === "__none__" ? null : value as OrderStatusPillLifecycleMapping,
            }))}
          >
            <SelectTrigger aria-label={`Lifecycle for ${pill.key}`}><SelectValue placeholder="Lifecycle" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">No lifecycle mapping</SelectItem>
              {orderStatusPillLifecycleMappingValues.map((value) => (
                <SelectItem key={value} value={value}>{formatWorkflowTriggerLabel(value)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            aria-label={`Category for ${pill.key}`}
            value={draft.category ?? ""}
            placeholder="Category"
            onChange={(event) => setDraft((current) => ({ ...current, category: event.target.value || null }))}
          />
          <span className="text-[11px] text-titan-text-muted">Canonical scope: {pill.stateScope}</span>
        </div>
      </TableCell>
      <TableCell className="w-[90px]">
        <Input
          aria-label={`Sort order for ${pill.key}`}
          type="number"
          value={draft.sortOrder}
          onChange={(event) => setDraft((current) => ({ ...current, sortOrder: Number(event.target.value || 0) }))}
        />
      </TableCell>
      <TableCell><Switch aria-label={`Active ${pill.key}`} checked={draft.isActive} onCheckedChange={(value) => setDraft((current) => ({ ...current, isActive: value }))} /></TableCell>
      <TableCell><Switch aria-label={`Customer visible ${pill.key}`} checked={draft.customerVisible} onCheckedChange={(value) => setDraft((current) => ({ ...current, customerVisible: value }))} /></TableCell>
      <TableCell><Switch aria-label={`Notification eligible ${pill.key}`} checked={draft.notificationTriggerEligible} onCheckedChange={(value) => setDraft((current) => ({ ...current, notificationTriggerEligible: value }))} /></TableCell>
      <TableCell className="text-right">
        <Button
          size="sm"
          variant={dirty ? "default" : "outline"}
          disabled={!dirty || !draft.name.trim() || update.isPending}
          onClick={() => update.mutate({ pillId: pill.id, updates: { ...draft, name: draft.name.trim() } })}
        >
          {update.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          <span className="sr-only">Save {pill.key}</span>
        </Button>
      </TableCell>
    </TableRow>
  );
}

export function OrderStatusPillSettings() {
  const pills = useOrderStatusPills(undefined, { includeInactive: true });
  const sorted = React.useMemo(
    () => [...(pills.data ?? [])].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
    [pills.data],
  );

  if (pills.isLoading) return <div className="flex items-center gap-2 text-sm text-titan-text-muted"><Loader2 className="h-4 w-4 animate-spin" /> Loading order status pills…</div>;
  if (pills.isError) return <div className="text-sm text-red-600">{(pills.error as Error).message}</div>;

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-titan-border-subtle bg-titan-bg-subtle p-3 text-sm text-titan-text-secondary">
        Labels, colors, and visibility are tenant settings. Stable keys are permanent automation identifiers and cannot be edited.
        These are the same statuses used by the Orders list selector and filter.
      </div>
      <div className="overflow-x-auto rounded-md border border-titan-border-subtle">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Status / stable key</TableHead>
              <TableHead>Lifecycle / category</TableHead>
              <TableHead>Sort</TableHead>
              <TableHead>Active</TableHead>
              <TableHead>Customer visible</TableHead>
              <TableHead>Notification eligible</TableHead>
              <TableHead className="text-right">Save</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="text-sm text-titan-text-muted">No order status pills configured.</TableCell></TableRow>
            ) : sorted.map((pill) => <StatusPillRow key={pill.id} pill={pill} />)}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

type MappingDraft = Pick<WorkflowStatusPillMapping, "targetStatusKey" | "source" | "isActive" | "overwriteExceptionStatus">;

function MappingRow({ mapping, pills }: { mapping: WorkflowStatusPillMapping; pills: OrderStatusPill[] }) {
  const update = useUpdateWorkflowStatusPillMapping();
  const [draft, setDraft] = React.useState<MappingDraft>({
    targetStatusKey: mapping.targetStatusKey,
    source: mapping.source,
    isActive: mapping.isActive,
    overwriteExceptionStatus: mapping.overwriteExceptionStatus,
  });
  React.useEffect(() => setDraft({
    targetStatusKey: mapping.targetStatusKey,
    source: mapping.source,
    isActive: mapping.isActive,
    overwriteExceptionStatus: mapping.overwriteExceptionStatus,
  }), [mapping]);
  const dirty = draft.targetStatusKey !== mapping.targetStatusKey || draft.source !== mapping.source || draft.isActive !== mapping.isActive || draft.overwriteExceptionStatus !== mapping.overwriteExceptionStatus;

  return (
    <TableRow className={!draft.isActive ? "opacity-65" : undefined}>
      <TableCell className="min-w-[240px]">
        <div className="font-medium text-titan-text-primary">{formatWorkflowTriggerLabel(mapping.triggerKey)}</div>
        <code className="text-[11px] text-titan-text-muted">{mapping.triggerKey}</code>
      </TableCell>
      <TableCell className="min-w-[220px]">
        <Select value={draft.targetStatusKey} onValueChange={(value) => setDraft((current) => ({ ...current, targetStatusKey: value }))}>
          <SelectTrigger aria-label={`Target for ${mapping.triggerKey}`}><SelectValue /></SelectTrigger>
          <SelectContent>
            {pills.filter((pill) => pill.isActive || pill.key === draft.targetStatusKey).map((pill) => (
              <SelectItem key={pill.key} value={pill.key}>
                {pill.name} ({pill.key}){pill.isActive ? "" : " — inactive"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell className="w-[150px]">
        <Select value={draft.source} onValueChange={(value) => setDraft((current) => ({ ...current, source: value as WorkflowStatusPillAssignmentSource }))}>
          <SelectTrigger aria-label={`Source for ${mapping.triggerKey}`}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="system">System workflow</SelectItem>
            <SelectItem value="automation">Automation rule</SelectItem>
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell><Switch aria-label={`Enabled ${mapping.triggerKey}`} checked={draft.isActive} onCheckedChange={(value) => setDraft((current) => ({ ...current, isActive: value }))} /></TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <Switch aria-label={`Resolve exceptions ${mapping.triggerKey}`} checked={draft.overwriteExceptionStatus} onCheckedChange={(value) => setDraft((current) => ({ ...current, overwriteExceptionStatus: value }))} />
          <span className="text-xs text-titan-text-muted">May replace On Hold / Problem</span>
        </div>
      </TableCell>
      <TableCell className="text-right">
        <Button size="sm" variant={dirty ? "default" : "outline"} disabled={!dirty || update.isPending} onClick={() => update.mutate({ triggerKey: mapping.triggerKey, updates: draft })}>
          {update.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          <span className="sr-only">Save {mapping.triggerKey}</span>
        </Button>
      </TableCell>
    </TableRow>
  );
}

export function WorkflowStatusAutomationSettings() {
  const mappings = useWorkflowStatusPillMappings();
  const pills = useOrderStatusPills(undefined, { includeInactive: true });
  const targetPills = React.useMemo(
    () => [...(pills.data ?? [])].sort((a, b) => a.sortOrder - b.sortOrder),
    [pills.data],
  );
  if (mappings.isLoading || pills.isLoading) return <div className="flex items-center gap-2 text-sm text-titan-text-muted"><Loader2 className="h-4 w-4 animate-spin" /> Loading workflow automation…</div>;
  if (mappings.isError || pills.isError) return <div className="text-sm text-red-600">{((mappings.error || pills.error) as Error).message}</div>;

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-titan-border-subtle bg-titan-bg-subtle p-3 text-sm text-titan-text-secondary">
        Workflow events assign order status pills by stable key. Disabling a mapping safely skips that update. Status-change events remain available for future notification rules.
      </div>
      <div className="overflow-x-auto rounded-md border border-titan-border-subtle">
        <Table>
          <TableHeader><TableRow><TableHead>Workflow trigger</TableHead><TableHead>Target order status</TableHead><TableHead>Event source</TableHead><TableHead>Enabled</TableHead><TableHead>Exception protection</TableHead><TableHead className="text-right">Save</TableHead></TableRow></TableHeader>
          <TableBody>
            {(mappings.data ?? []).length === 0
              ? <TableRow><TableCell colSpan={6} className="text-sm text-titan-text-muted">No workflow status mappings configured.</TableCell></TableRow>
              : (mappings.data ?? []).map((mapping) => <MappingRow key={mapping.id} mapping={mapping} pills={targetPills} />)}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
