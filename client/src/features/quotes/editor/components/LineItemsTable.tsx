import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { FileText, ChevronDown, Pencil, Copy, Trash2, Paperclip } from "lucide-react";
import type { Product } from "@shared/schema";
import type { QuoteLineItemDraft } from "../types";
import { LineItemArtworkBadge } from "@/components/LineItemAttachmentsPanel";

type LineItemsTableProps = {
    lineItems: QuoteLineItemDraft[];
    products: Product[];
    quoteId: string | null;
    onEdit: (id: string) => void;
    onDuplicate: (id: string) => void;
    onRemove: (id: string) => void;
    onOpenAttachments: (item: QuoteLineItemDraft) => void;
};

export function LineItemsTable({
    lineItems,
    products,
    quoteId,
    onEdit,
    onDuplicate,
    onRemove,
    onOpenAttachments,
}: LineItemsTableProps) {
    return (
        <>
            <Card className="rounded-xl bg-card/80 border-border/60 shadow-md">
                <CardHeader className="pb-2 px-5 pt-4">
                    <div className="flex items-center justify-between">
                        <CardTitle className="text-sm font-medium">Line Items</CardTitle>
                        <Badge variant="outline">{lineItems.length} item{lineItems.length !== 1 ? 's' : ''}</Badge>
                    </div>
                </CardHeader>
                <CardContent className="px-5 pb-4">
                    {lineItems.length === 0 ? (
                        <div className="py-6 text-center text-muted-foreground">
                            <FileText className="w-8 h-8 mx-auto mb-2 opacity-50" />
                            <p className="text-sm">No line items yet</p>
                            <p className="text-xs">Configure a product above to add items</p>
                        </div>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Product</TableHead>
                                    <TableHead className="text-center">Size</TableHead>
                                    <TableHead className="text-center">Qty</TableHead>
                                    <TableHead className="text-right">Price</TableHead>
                                    <TableHead className="text-center">Artwork</TableHead>
                                    <TableHead className="w-[80px]"></TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {lineItems
                                    .filter((item) => item.status !== "draft")
                                    .map((item) => {
                                        const hasAttachmentOption = Array.isArray(item.productOptions)
                                            ? item.productOptions.some((opt) => opt.type === "attachment")
                                            : false;
                                        return (
                                            <TableRow key={item.tempId || item.id}>
                                                <TableCell>
                                                    <div className="font-medium text-sm">{item.productName}</div>
                                                    {item.variantName && (
                                                        <div className="text-xs text-muted-foreground">{item.variantName}</div>
                                                    )}
                                                    {item.selectedOptions && item.selectedOptions.length > 0 && (
                                                        <div className="flex flex-wrap gap-1 mt-1">
                                                            {item.selectedOptions.map((opt: any, idx: number) => (
                                                                <Badge key={idx} variant="outline" className="text-xs py-0">
                                                                    {opt.optionName}
                                                                </Badge>
                                                            ))}
                                                        </div>
                                                    )}
                                                    {item.notes && (
                                                        <div className="text-xs italic text-muted-foreground mt-1 truncate max-w-[200px]">
                                                            {item.notes}
                                                        </div>
                                                    )}
                                                </TableCell>
                                                <TableCell className="text-center text-sm">
                                                    {item.width > 1 || item.height > 1 ? (
                                                        `${item.width}" × ${item.height}"`
                                                    ) : (
                                                        <span className="text-muted-foreground">—</span>
                                                    )}
                                                </TableCell>
                                                <TableCell className="text-center text-sm">{item.quantity}</TableCell>
                                                <TableCell className="text-right font-mono text-sm">
                                                    ${item.linePrice.toFixed(2)}
                                                </TableCell>
                                                <TableCell className="text-center">
                                                    {hasAttachmentOption && item.id ? (
                                                        <LineItemArtworkBadge
                                                            quoteId={quoteId}
                                                            lineItemId={item.id}
                                                            onClick={() => onOpenAttachments(item)}
                                                        />
                                                    ) : hasAttachmentOption ? (
                                                        <span className="text-xs text-muted-foreground">Pending…</span>
                                                    ) : (
                                                        <span className="text-xs text-muted-foreground">—</span>
                                                    )}
                                                </TableCell>
                                                <TableCell>
                                                    <DropdownMenu>
                                                        <DropdownMenuTrigger asChild>
                                                            <Button variant="ghost" size="icon" className="h-8 w-8">
                                                                <ChevronDown className="w-4 h-4" />
                                                            </Button>
                                                        </DropdownMenuTrigger>
                                                        <DropdownMenuContent align="end">
                                                            <DropdownMenuItem onClick={() => {
                                                                if (item.id) {
                                                                    onEdit(item.id);
                                                                }
                                                            }}>
                                                                <Pencil className="w-4 h-4 mr-2" />
                                                                Edit
                                                            </DropdownMenuItem>
                                                            <DropdownMenuItem onClick={() => onDuplicate(item.tempId || item.id || '')}>
                                                                <Copy className="w-4 h-4 mr-2" />
                                                                Duplicate
                                                            </DropdownMenuItem>
                                                            <DropdownMenuItem
                                                                onClick={() => onRemove(item.tempId || item.id || '')}
                                                                className="text-destructive"
                                                            >
                                                                <Trash2 className="w-4 h-4 mr-2" />
                                                                Remove
                                                            </DropdownMenuItem>
                                                        </DropdownMenuContent>
                                                    </DropdownMenu>
                                                </TableCell>
                                            </TableRow>
                                        )
                                    })
                                }
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>

            {/* Artwork Hint Card - shown when there are line items */}
            {lineItems.length > 0 && (
                <Card className="rounded-xl bg-muted/30 border-border/40">
                    <CardContent className="p-4">
                        <div className="flex items-start gap-3">
                            <Paperclip className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                            <div className="text-sm text-muted-foreground">
                                <p className="font-medium text-foreground">Per-Line-Item Artwork</p>
                                <p className="mt-1">
                                    Click the artwork badge on any line item to attach files.
                                </p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            )}
        </>
    );
}
