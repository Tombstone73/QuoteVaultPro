import * as React from "react";
import { useInvoices } from "@/hooks/useInvoices";
import { useTableColumnConfig, ColumnConfig } from "@/hooks/useTableColumnConfig";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";

const DEFAULT_COLUMNS: ColumnConfig[] = [
  { id: "invoiceNumber", label: "Invoice #", visible: true, order: 0 },
  { id: "date", label: "Date", visible: true, order: 1 },
  { id: "amount", label: "Amount", visible: true, order: 2 },
  { id: "dueDate", label: "Due Date", visible: true, order: 3 },
  { id: "status", label: "Status", visible: true, order: 4 },
  { id: "actions", label: "Actions", visible: true, order: 5 },
];

export function CustomerInvoicesTable({ customerId }: { customerId: string }) {
  const { data: invoices = [], isLoading } = useInvoices({ customerId });
  const cfg = useTableColumnConfig("customer_invoices", DEFAULT_COLUMNS);
  const [open, setOpen] = React.useState(false);
  const cols = cfg.columns.filter(c => c.visible);

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm" style={{ color: 'var(--text-muted)' }}>Invoices</div>
        <Button
          size="sm"
          variant="secondary"
          className="border"
          style={{ backgroundColor: 'var(--button-secondary-bg)', color: 'var(--button-secondary-text)', borderColor: 'var(--border-subtle)' }}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = getComputedStyle(document.documentElement).getPropertyValue('--button-secondary-hover-bg'))}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = getComputedStyle(document.documentElement).getPropertyValue('--button-secondary-bg'))}
          onClick={() => setOpen(true)}
        >
          Columns
        </Button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm" style={{ color: 'var(--text-primary)' }}>
          <thead style={{ backgroundColor: 'var(--table-header-bg)' }}>
            <tr className="text-left" style={{ color: 'var(--table-header-text)' }}>
              {cols.map(c => (
                <th key={c.id} className="px-3 py-2 font-medium">{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td className="px-3 py-6" style={{ color: 'var(--text-muted)' }} colSpan={cols.length}>Loading...</td></tr>
            ) : invoices.length === 0 ? (
              <tr><td className="px-3 py-6" style={{ color: 'var(--text-muted)' }} colSpan={cols.length}>No invoices</td></tr>
            ) : invoices.map((inv: any) => (
              <tr key={inv.id} className="border-t" style={{ borderColor: 'var(--table-border-color)' }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = getComputedStyle(document.documentElement).getPropertyValue('--table-row-hover-bg'))}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
              >
                {cols.map(c => {
                  switch (c.id) {
                    case "invoiceNumber": return <td className="px-3 py-2 font-mono" style={{ color: 'var(--text-primary)' }} key={c.id}>{inv.invoiceNumber}</td>;
                    case "date": return <td className="px-3 py-2" style={{ color: 'var(--text-muted)' }} key={c.id}>{inv.createdAt ? new Date(inv.createdAt).toLocaleDateString() : "-"}</td>;
                    case "amount": return <td className="px-3 py-2" style={{ color: 'var(--text-muted)' }} key={c.id}>${Number(inv.total || 0).toFixed(2)}</td>;
                    case "dueDate": return <td className="px-3 py-2" style={{ color: 'var(--text-muted)' }} key={c.id}>{inv.dueDate ? new Date(inv.dueDate).toLocaleDateString() : "-"}</td>;
                    case "status": return <td className="px-3 py-2" style={{ color: 'var(--text-muted)' }} key={c.id}>{inv.status}</td>;
                    case "actions": return <td className="px-3 py-2 text-right" key={c.id}><a style={{ color: 'var(--accent-primary)' }} className="hover:underline" href={`/invoices/${inv.id}`}>View</a></td>;
                    default: return null;
                  }
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Configure Columns</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-2">
            {cfg.columns.map(col => (
              <label key={col.id} className="flex items-center gap-3">
                <Checkbox checked={col.visible} onCheckedChange={(v) => cfg.setColumnVisibility(col.id, Boolean(v))} />
                <span className="text-sm">{col.label}</span>
                <div className="ml-auto flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => cfg.moveColumn(col.id, "up")}>Up</Button>
                  <Button variant="outline" size="sm" onClick={() => cfg.moveColumn(col.id, "down")}>Down</Button>
                </div>
              </label>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => cfg.reset()}>Reset</Button>
            <Button onClick={() => setOpen(false)}>Close</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
