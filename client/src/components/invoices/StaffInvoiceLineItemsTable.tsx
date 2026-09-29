import type { InvoiceLineItem } from "@shared/schema";
import { projectStaffInvoiceLineHierarchy, resolveInvoiceLinePresentation } from "@shared/invoiceLinePresentation";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export function StaffInvoiceLineItemsTable({
  lineItems,
  isImportedFromQuickBooks,
  formatCurrency,
}: {
  lineItems: InvoiceLineItem[];
  isImportedFromQuickBooks: boolean;
  formatCurrency: (amount: string | number) => string;
}) {
  const rows = projectStaffInvoiceLineHierarchy(lineItems);
  return <div className="w-full overflow-x-auto">
    <Table className="min-w-[560px]">
      <TableHeader><TableRow>
        <TableHead>Description</TableHead>
        <TableHead>Quantity</TableHead>
        <TableHead>Unit Price</TableHead>
        <TableHead className="text-right">Total</TableHead>
      </TableRow></TableHeader>
      <TableBody>
        {rows.length === 0 ? <TableRow><TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
          {isImportedFromQuickBooks ? 'No Printers Hero production line items for this imported invoice.' : 'No line items recorded.'}
        </TableCell></TableRow> : rows.map(({ line, lineNumber, parentLineNumber, childCount }) => {
          const presentation = resolveInvoiceLinePresentation(line);
          const child = parentLineNumber != null;
          return <TableRow key={line.id} className={child ? "bg-muted/20" : undefined}>
            <TableCell className="min-w-0 align-top">
              <div className={child ? "ml-2 border-l-2 border-primary/30 pl-3 sm:ml-4" : undefined}>
                {child ? <Badge variant="outline" className="mb-1 whitespace-normal text-left text-xs">
                  Child item · Runs with Line {parentLineNumber}
                </Badge> : childCount > 0 ? <div className="mb-1 flex flex-wrap items-center gap-2">
                  <span className="text-xs text-muted-foreground">Line {lineNumber}</span>
                  <Badge variant="outline">Group · {childCount} child {childCount === 1 ? "item" : "items"}</Badge>
                </div> : null}
                <div className="break-words font-medium">{presentation.primaryLabel}</div>
                {presentation.secondaryLabel && <div className="break-words text-sm text-muted-foreground">{presentation.secondaryLabel}</div>}
                {presentation.dimensionsLabel && <div className="text-sm text-muted-foreground">{presentation.dimensionsLabel}</div>}
              </div>
            </TableCell>
            <TableCell className="align-top">{line.quantity}</TableCell>
            <TableCell className="align-top">{formatCurrency(line.unitPrice)}</TableCell>
            <TableCell className="text-right align-top font-medium">{formatCurrency(line.totalPrice)}</TableCell>
          </TableRow>;
        })}
      </TableBody>
    </Table>
  </div>;
}
