import { Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { InvoiceBulkActionPermissions } from "@shared/invoiceBulkActionPermissions";

type Props = {
  selectedCount: number;
  permissions?: InvoiceBulkActionPermissions;
  sending: boolean;
  markingSent: boolean;
  approving: boolean;
  onSend(): void;
  onMarkSent(): void;
  onApprove(): void;
  onAddPayment(): void;
};

export function InvoiceBulkActions({ selectedCount, permissions, sending, markingSent, approving, onSend, onMarkSent, onApprove, onAddPayment }: Props) {
  if (selectedCount === 0) return null;
  return <div className="flex flex-wrap items-center gap-2 rounded-md border border-titan-border-subtle bg-titan-bg-card px-2 py-1.5" data-testid="invoice-selection-actions">
    <span className="text-sm font-medium text-titan-text-primary" role="status">{selectedCount} selected</span>
    {permissions?.send && <Button variant="outline" size="sm" onClick={onSend} disabled={sending}><Mail className="mr-1.5 h-4 w-4" />{sending ? "Preparing..." : "Send Selected"}</Button>}
    {permissions?.markSent && <Button variant="outline" size="sm" onClick={onMarkSent} disabled={markingSent}>{markingSent ? "Marking…" : "Mark as Sent"}</Button>}
    {permissions?.approve && <Button variant="outline" size="sm" onClick={onApprove} disabled={approving}>{approving ? "Approving…" : "Approve Selected"}</Button>}
    {permissions?.payment && <Button variant="outline" size="sm" onClick={onAddPayment}>Add Payment</Button>}
    {permissions && !Object.values(permissions).some(Boolean) && <span className="text-sm text-muted-foreground">No bulk actions available for your permissions.</span>}
  </div>;
}
