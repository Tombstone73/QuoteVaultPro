import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { useTableColumnConfig, ColumnConfig } from "@/hooks/useTableColumnConfig";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Link } from "wouter";
import { Eye, Download, Mail, Edit as EditIcon } from "lucide-react";

const DEFAULT_COLUMNS: ColumnConfig[] = [
  { id: "quoteNumber", label: "Quote #", visible: true, order: 0 },
  { id: "date", label: "Date", visible: true, order: 1 },
  { id: "product", label: "Product", visible: true, order: 2 },
  { id: "quantity", label: "Qty", visible: true, order: 3 },
  { id: "amount", label: "Amount", visible: true, order: 4 },
  { id: "status", label: "Status", visible: true, order: 5 },
  { id: "actions", label: "Actions", visible: true, order: 6 },
];

export function CustomerQuotesTable({ customerId }: { customerId: string }) {
  const { data = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/quotes", { customerId }],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.append("customerId", customerId);
      const res = await fetch(`/api/quotes?${params.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load quotes");
      return res.json();
    },
    enabled: !!customerId,
  });

  const cfg = useTableColumnConfig("customer_quotes", DEFAULT_COLUMNS);
  const [open, setOpen] = React.useState(false);
  const cols = cfg.columns.filter(c => c.visible);

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm" style={{ color: 'var(--text-muted)' }}>Quotes</div>
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
            ) : data.length === 0 ? (
              <tr><td className="px-3 py-6" style={{ color: 'var(--text-muted)' }} colSpan={cols.length}>No quotes</td></tr>
            ) : data.map((q: any) => (
              <tr key={q.id} className="border-t" style={{ borderColor: 'var(--table-border-color)' }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = getComputedStyle(document.documentElement).getPropertyValue('--table-row-hover-bg'))}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
              >
                {cols.map(c => {
                  switch (c.id) {
                    case "quoteNumber": return <td className="px-3 py-2 font-mono" style={{ color: 'var(--text-primary)' }} key={c.id}>{q.quoteNumber}</td>;
                    case "date": return <td className="px-3 py-2" style={{ color: 'var(--text-muted)' }} key={c.id}>{q.createdAt ? new Date(q.createdAt).toLocaleDateString() : "-"}</td>;
                    case "product": return <td className="px-3 py-2" style={{ color: 'var(--text-muted)' }} key={c.id}>{Array.isArray(q.lineItems) && q.lineItems[0]?.description || "-"}</td>;
                    case "quantity": return <td className="px-3 py-2" style={{ color: 'var(--text-muted)' }} key={c.id}>{Array.isArray(q.lineItems) ? q.lineItems.reduce((n: number, li: any) => n + (li.quantity || 0), 0) : 0}</td>;
                    case "amount": return <td className="px-3 py-2" style={{ color: 'var(--text-muted)' }} key={c.id}>${Number(q.totalPrice || 0).toFixed(2)}</td>;
                    case "status": return <td className="px-3 py-2" style={{ color: 'var(--text-muted)' }} key={c.id}>{q.status}</td>;
                    case "actions": return (
                      <td className="px-3 py-2" key={c.id}>
                        <div className="flex items-center justify-end gap-2">
                          <Link href={`/quotes/${q.id}`}>
                            <button title="View" className="h-7 w-7 rounded-full border flex items-center justify-center"
                              style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-muted)', backgroundColor: 'transparent' }}
                              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = getComputedStyle(document.documentElement).getPropertyValue('--bg-surface-soft'))}
                              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                            >
                              <Eye className="h-4 w-4" />
                            </button>
                          </Link>
                          <button title="Download" className="h-7 w-7 rounded-full border flex items-center justify-center"
                            style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-muted)', backgroundColor: 'transparent' }}
                            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = getComputedStyle(document.documentElement).getPropertyValue('--bg-surface-soft'))}
                            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                          >
                            <Download className="h-4 w-4" />
                          </button>
                          <button title="Email" className="h-7 w-7 rounded-full border flex items-center justify-center"
                            style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-muted)', backgroundColor: 'transparent' }}
                            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = getComputedStyle(document.documentElement).getPropertyValue('--bg-surface-soft'))}
                            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                          >
                            <Mail className="h-4 w-4" />
                          </button>
                          <Link href={`/quotes/${q.id}`}>
                            <button title="Edit" className="h-7 w-7 rounded-full border flex items-center justify-center"
                              style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-muted)', backgroundColor: 'transparent' }}
                              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = getComputedStyle(document.documentElement).getPropertyValue('--bg-surface-soft'))}
                              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                            >
                              <EditIcon className="h-4 w-4" />
                            </button>
                          </Link>
                        </div>
                      </td>
                    );
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
