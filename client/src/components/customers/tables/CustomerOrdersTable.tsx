import * as React from "react";
import { useOrders } from "@/hooks/useOrders";
import { useTableColumnConfig, ColumnConfig } from "@/hooks/useTableColumnConfig";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { Eye, Download, Mail, Edit as EditIcon } from "lucide-react";

const DEFAULT_COLUMNS: ColumnConfig[] = [
  { id: "orderNumber", label: "Order #", visible: true, order: 0 },
  { id: "date", label: "Date", visible: true, order: 1 },
  { id: "product", label: "Product", visible: true, order: 2 },
  { id: "quantity", label: "Qty", visible: true, order: 3 },
  { id: "amount", label: "Amount", visible: true, order: 4 },
  { id: "dueDate", label: "Due Date", visible: true, order: 5 },
  { id: "status", label: "Status", visible: true, order: 6 },
  { id: "actions", label: "Actions", visible: true, order: 7 },
];

export function CustomerOrdersTable({ customerId }: { customerId: string }) {
  const { data: orders = [], isLoading } = useOrders({ customerId });
  const cfg = useTableColumnConfig("customer_orders", DEFAULT_COLUMNS);
  const [open, setOpen] = React.useState(false);

  const cols = cfg.columns.filter(c => c.visible);
  const ordersAny = orders as any[];

  const statusPillStyle = (status: string): React.CSSProperties => {
    const s = (status || '').toLowerCase();
    let bg = 'var(--badge-muted-bg)';
    switch (s) {
      case 'completed':
        bg = 'var(--accent-success)';
        break;
      case 'in_production':
      case 'new':
      case 'scheduled':
        bg = 'var(--accent-primary)';
        break;
      case 'shipped':
        bg = 'var(--accent-purple)';
        break;
      case 'ready_for_pickup':
        bg = 'var(--accent-teal)';
        break;
      case 'on_hold':
        bg = 'var(--accent-warning)';
        break;
      case 'canceled':
        bg = 'var(--accent-danger)';
        break;
    }
    return {
      backgroundColor: bg,
      color: '#ffffff',
      borderRadius: 9999,
      padding: '4px 10px',
      fontSize: '12px',
      fontWeight: 700,
      display: 'inline-block'
    } as React.CSSProperties;
  };

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm" style={{ color: 'var(--text-muted)' }}>Orders</div>
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
            ) : orders.length === 0 ? (
              <tr><td className="px-3 py-6" style={{ color: 'var(--text-muted)' }} colSpan={cols.length}>No orders</td></tr>
            ) : ordersAny.map((o: any) => (
              <tr key={o.id} className="border-t" style={{ borderColor: 'var(--table-border-color)' }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = getComputedStyle(document.documentElement).getPropertyValue('--table-row-hover-bg'))}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
              >
                {cols.map(c => {
                  switch (c.id) {
                    case "orderNumber": return <td className="px-3 py-2 font-mono" style={{ color: 'var(--text-primary)' }} key={c.id}>{o.orderNumber}</td>;
                    case "date": return <td className="px-3 py-2" style={{ color: 'var(--text-muted)' }} key={c.id}>{o.createdAt ? new Date(o.createdAt).toLocaleDateString() : "-"}</td>;
                    case "product": return <td className="px-3 py-2" style={{ color: 'var(--text-muted)' }} key={c.id}>{Array.isArray(o.lineItems) && o.lineItems[0]?.description || "-"}</td>;
                    case "quantity": return <td className="px-3 py-2" style={{ color: 'var(--text-muted)' }} key={c.id}>{Array.isArray(o.lineItems) ? o.lineItems.reduce((n: number, li: any) => n + (li.quantity || 0), 0) : 0}</td>;
                    case "amount": return <td className="px-3 py-2" style={{ color: 'var(--text-muted)' }} key={c.id}>${Number(o.total || 0).toFixed(2)}</td>;
                    case "dueDate": return <td className="px-3 py-2" style={{ color: 'var(--text-muted)' }} key={c.id}>{o.dueDate ? new Date(o.dueDate).toLocaleDateString() : "-"}</td>;
                    case "status": return (
                      <td className="px-3 py-2" key={c.id}>
                        <span style={statusPillStyle(o.status)}>
                          {String(o.status || '').replace(/_/g, ' ').replace(/\b\w/g, (m: string) => m.toUpperCase())}
                        </span>
                      </td>
                    );
                    case "actions": return (
                      <td className="px-3 py-2" key={c.id}>
                        <div className="flex items-center justify-end gap-2">
                          <Link href={`/orders/${o.id}`}>
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
                          <Link href={`/orders/${o.id}`}>
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
                  <Button variant="outline" size="sm">Up</Button>
                  <Button variant="outline" size="sm">Down</Button>
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
