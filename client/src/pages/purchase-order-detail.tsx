import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useWorkspaceNavigate, useWorkspaceParams } from "@/contexts/WorkspaceContext";
import { useWorkspaceTitle } from "@/features/workspaces/WorkspaceTitle";
import { useActiveOrganizationRole } from "@/hooks/useActiveOrganizationRole";
import { purchaseOrderRequest, useDeletePurchaseOrder, usePurchaseOrder, useSendPurchaseOrder, useUpdatePurchaseOrder, type PurchaseOrder } from "@/hooks/usePurchaseOrders";
import { PurchaseOrderForm } from "@/components/PurchaseOrderForm";
import { ReceivePurchaseOrderItemsForm } from "@/components/ReceivePurchaseOrderItemsForm";
import { PurchaseOrderActualCostDialog } from "@/components/PurchaseOrderActualCostDialog";
import { PurchaseOrderEmailDialog, purchaseOrderPdfUrl } from "@/components/PurchaseOrderEmailDialog";
import { PurchaseOrderSummary, purchaseMoney } from "@/components/PurchaseOrderSummary";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Page, PageHeader, ContentLayout, DataCard } from "@/components/titan";
import { editablePurchaseOrderStatuses, receivablePurchaseOrderStatuses } from "@shared/purchaseOrderWorkflow";
import { ArrowLeft, Mail, PackageCheck, Send, Trash2 } from "lucide-react";

function activityValues(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function PurchaseOrderHistory({ po, dirty, canManage }: { po: PurchaseOrder; dirty: boolean; canManage: boolean }) {
  const queryClient = useQueryClient();
  const [reference, setReference] = useState("");
  const [error, setError] = useState("");
  const [acknowledging, setAcknowledging] = useState(false);
  const sent = new Set(po.timeline?.filter(event => event.actionType === "EMAIL_ACCEPTED").map(event => activityValues(event.newValues).revision));

  async function acknowledge() {
    if (dirty || acknowledging || po.revision === null || !reference.trim()) return;
    setAcknowledging(true);
    setError("");
    try {
      await purchaseOrderRequest("/api/purchase-orders/" + po.id + "/acknowledge", { revision: po.revision, reference });
      setReference("");
      void queryClient.invalidateQueries({ queryKey: ["/api/purchase-orders", po.id] });
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not record acknowledgment.");
    } finally {
      setAcknowledging(false);
    }
  }

  return <>
    <DataCard title="Issued revisions">
      {po.revisions?.length ? <ul className="divide-y">
        {po.revisions.map(revision => <li key={revision.revision} className="flex flex-wrap items-center justify-between gap-2 py-2">
          <div>
            <p className="font-medium">{revision.source === "legacy_capture" ? "Archived legacy agreement" : "Revision " + revision.revision} · {purchaseMoney(revision.total)}</p>
            <p className="text-sm text-muted-foreground">{new Date(revision.createdAt).toLocaleString()} · {sent.has(revision.revision) ? "Gmail accepted" : "No recorded Gmail acceptance"}</p>
            {revision.reason && <p className="break-words text-sm">{revision.reason}</p>}
          </div>
          {dirty ? <span className="text-sm text-muted-foreground">Save changes to open PDF</span> :
            <Button asChild variant="outline" size="sm"><a href={purchaseOrderPdfUrl(po.id, revision.revision)} target="_blank" rel="noreferrer">Open revision PDF</a></Button>}
        </li>)}
      </ul> : <p className="text-sm text-muted-foreground">{po.status === "draft" ? "Issue this purchase order to save its first revision." : "No verified revision history is available for this legacy purchase order."}</p>}
    </DataCard>
    <DataCard title="Activity timeline">
      {canManage && !dirty && po.revision !== null && po.status !== "cancelled" && <div className="mb-4 flex flex-wrap items-end gap-2">
        <label className="min-w-56 flex-1 text-sm">Vendor acknowledgment reference
          <Input value={reference} onChange={event => setReference(event.target.value)} placeholder="Confirmation email or reference" maxLength={1000} />
        </label>
        <Button variant="outline" onClick={() => void acknowledge()} disabled={!reference.trim() || acknowledging}>Record acknowledgment</Button>
        {error && <p role="alert" className="w-full text-sm text-destructive">{error}</p>}
      </div>}
      {po.timeline?.length ? <ol className="divide-y">
        {po.timeline.map(event => {
          const next = activityValues(event.newValues);
          const recipients = activityValues(next.recipients);
          const recipientSummary = ["to", "cc", "bcc"].flatMap(key => Array.isArray(recipients[key]) && recipients[key].length
            ? [key.toUpperCase() + " " + (recipients[key] as string[]).join(", ")] : []);
          return <li key={event.id} className="min-w-0 space-y-1 py-2">
            <p className="break-words font-medium">{event.description}</p>
            <p className="text-sm text-muted-foreground"><time dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleString()}</time>
              {event.userName || event.userId ? " · " + (event.userName || event.userId) : ""}
            </p>
            {recipientSummary.length > 0 && <p className="break-words text-sm">{recipientSummary.join(" · ")}</p>}
            {(event.oldValues != null || event.newValues != null) && <details className="text-sm">
              <summary className="cursor-pointer">Event details</summary>
              <dl className="grid gap-2 md:grid-cols-2">
                {event.oldValues != null && <div><dt>Previous</dt><dd><pre className="max-h-60 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-2">{JSON.stringify(event.oldValues, null, 2)}</pre></dd></div>}
                {event.newValues != null && <div><dt>Recorded</dt><dd><pre className="max-h-60 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-2">{JSON.stringify(event.newValues, null, 2)}</pre></dd></div>}
              </dl>
            </details>}
          </li>;
        })}
      </ol> : <p className="text-sm text-muted-foreground">No recorded activity.</p>}
    </DataCard>
  </>;
}

export default function PurchaseOrderDetailPage() {
  const { id } = useWorkspaceParams();
  const navigate = useWorkspaceNavigate();
  const query = usePurchaseOrder(id);
  const queryClient = useQueryClient();
  const po = query.data;
  useWorkspaceTitle(po?.poNumber);
  const { isAdminOrOwner } = useActiveOrganizationRole();
  const issueMutation = useSendPurchaseOrder(id || "");
  const updateMutation = useUpdatePurchaseOrder(id || "");
  const deleteMutation = useDeletePurchaseOrder();
  const [dirty, setDirty] = useState(false);
  const [dialog, setDialog] = useState<"receive" | "actual" | "email" | null>(null);
  const [emailRevision, setEmailRevision] = useState<number | null>(null);
  const [actionError, setActionError] = useState("");
  const [archiving, setArchiving] = useState(false);

  if (!po) return <Page><ContentLayout><DataCard title="Purchase Order">
    {query.isError ? <div className="space-y-2"><p role="alert">Could not load purchase order.</p><Button onClick={() => void query.refetch()}>Retry</Button></div>
      : <p role="status">Loading purchase order…</p>}
  </DataCard></ContentLayout></Page>;

  const canEdit = isAdminOrOwner && editablePurchaseOrderStatuses.includes(po.status);
  const canIssue = isAdminOrOwner && po.status === "draft";
  const canReceive = isAdminOrOwner && receivablePurchaseOrderStatuses.includes(po.status);
  const canCost = isAdminOrOwner && ["issued", "sent", "partially_received", "received", "closed"].includes(po.status);
  const canSend = canCost && po.revision !== null && Boolean(po.vendor);
  const canCancel = isAdminOrOwner && ["draft", "sent", "issued"].includes(po.status) && po.lineItems.every(line => Number(line.quantityReceived) === 0);
  const canClose = isAdminOrOwner && po.status === "received";
  const actionPending = issueMutation.isPending || updateMutation.isPending || deleteMutation.isPending || archiving;

  async function runAction(action: () => Promise<unknown>) {
    setActionError("");
    try { await action(); }
    catch (error) { setActionError(error instanceof Error ? error.message : "Purchase order action failed."); }
  }

  return <Page>
    <PageHeader title={"Purchase Order " + po.poNumber} actions={<div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" onClick={() => navigate("/purchase-orders")}><ArrowLeft className="mr-2 h-4 w-4" />Back</Button>
      <Badge variant="outline" className="capitalize">{po.status.replace(/_/g, " ")}</Badge>
      {canIssue && <Button disabled={dirty || actionPending} onClick={() => void runAction(() => issueMutation.mutateAsync(po.version))}>
        <Send className="mr-2 h-4 w-4" />{issueMutation.isPending ? "Issuing…" : "Issue PO"}
      </Button>}
      {canSend && <Button variant="outline" disabled={dirty || actionPending} onClick={() => {
        setEmailRevision(po.revision); setDialog("email");
      }}><Mail className="mr-2 h-4 w-4" />Send PO</Button>}
      {canCost && po.revision === null && po.vendor && <Button variant="outline" disabled={dirty || actionPending} onClick={() => {
        setArchiving(true);
        void runAction(async () => {
          await purchaseOrderRequest("/api/purchase-orders/" + po.id + "/archive-current", { expectedVersion: po.version });
          await queryClient.invalidateQueries({ queryKey: ["/api/purchase-orders"] });
        }).finally(() => setArchiving(false));
      }}>{archiving ? "Saving PDF…" : "Save Current Agreement PDF"}</Button>}
      {canReceive && <Button variant="secondary" disabled={dirty || actionPending} onClick={() => setDialog("receive")}>
        <PackageCheck className="mr-2 h-4 w-4" />Receive Items
      </Button>}
      {canCost && <Button variant="outline" disabled={dirty || actionPending} onClick={() => setDialog("actual")}>Record Actual Cost</Button>}
      {(canCancel || canClose) && <Button variant="outline" disabled={dirty || actionPending} onClick={() => {
        if (window.confirm(canClose ? "Close this received purchase order?" : "Cancel this purchase order?"))
          void runAction(() => updateMutation.mutateAsync({ expectedVersion: po.version, status: canClose ? "closed" : "cancelled" }));
      }}>{canClose ? "Close PO" : "Cancel PO"}</Button>}
      {canIssue && <Button variant="destructive" disabled={dirty || actionPending} onClick={() => {
        if (window.confirm("Delete draft " + po.poNumber + "?")) void runAction(async () => {
          await deleteMutation.mutateAsync(po.id);
          navigate("/purchase-orders");
        });
      }}><Trash2 className="mr-2 h-4 w-4" />Delete Draft</Button>}
    </div>} />
    <ContentLayout>
      {dirty && <p className="text-sm text-muted-foreground">Save your changes before opening a PDF, sending, receiving, or recording actual costs.</p>}
      {actionError && <p role="alert" className="text-sm text-destructive">{actionError}</p>}
      <DataCard title="Purchase and actual costs"><PurchaseOrderSummary po={po} /></DataCard>
      <PurchaseOrderForm key={po.id} purchaseOrder={po} readOnly={!canEdit} onDirtyChange={setDirty}
        onCancel={() => navigate("/purchase-orders")} onSaved={() => setDirty(false)} />
      <PurchaseOrderHistory po={po} dirty={dirty} canManage={isAdminOrOwner} />
    </ContentLayout>
    {dialog === "receive" && <ReceivePurchaseOrderItemsForm open onOpenChange={open => { if (!open) setDialog(null); }} purchaseOrder={po} />}
    {dialog === "actual" && <PurchaseOrderActualCostDialog po={po} onClose={() => setDialog(null)} />}
    {dialog === "email" && emailRevision !== null && !dirty && <PurchaseOrderEmailDialog po={po} revision={emailRevision} open
      onRevisionChange={setEmailRevision} onOpenChange={open => { if (!open) setDialog(null); }} />}
  </Page>;
}
