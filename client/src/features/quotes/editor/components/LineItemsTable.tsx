import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { FileText, ChevronDown, Pencil, Copy, Trash2, Paperclip, RotateCcw } from "lucide-react";
import type { Product } from "@shared/schema";
import type { QuoteLineItemDraft } from "../types";
import { LineItemArtworkBadge } from "@/components/LineItemAttachmentsPanel";
import { useMemo, useState } from "react";

type LineItemsTableProps = {
    lineItems: QuoteLineItemDraft[];
    products: Product[];
    quoteId: string | null;
    readOnly?: boolean;
    onEdit: (id: string) => void;
    onDuplicate: (id: string) => void;
    onRemove: (id: string) => void;
    onOpenAttachments: (item: QuoteLineItemDraft) => void;
    onSetLineItemPriceOverride?: (itemKey: string, nextPrice: number | null) => void;
};

export function LineItemsTable({
    lineItems,
    products,
    quoteId,
    readOnly = false,
    onEdit,
    onDuplicate,
    onRemove,
    onOpenAttachments,
    onSetLineItemPriceOverride,
}: LineItemsTableProps) {
    const [editingPriceKey, setEditingPriceKey] = useState<string | null>(null);
    const [editingPriceText, setEditingPriceText] = useState<string>("");

    const setPriceOverride = useMemo(() => {
        return onSetLineItemPriceOverride ?? (() => undefined);
    }, [onSetLineItemPriceOverride]);

    const parsePriceInput = (raw: string): number | null => {
        const trimmed = raw.trim();
        if (!trimmed) return null;
        const normalized = trimmed.replace(/[$,]/g, "");
        const n = Number.parseFloat(normalized);
        if (!Number.isFinite(n)) return null;
        return n;
    };

    const startEditingPrice = (itemKey: string, current: number) => {
        setEditingPriceKey(itemKey);
        setEditingPriceText(current.toFixed(2));
    };

    const commitEditingPrice = (itemKey: string) => {
        const parsed = parsePriceInput(editingPriceText);

        // Empty input = reset
        if (parsed == null && editingPriceText.trim() === "") {
            // TODO: log price override to audit log
            setPriceOverride(itemKey, null);
            setEditingPriceKey(null);
            return;
        }

        if (parsed == null) {
            // Invalid: keep editing but don't commit
            return;
        }

        // TODO: log price override to audit log
        setPriceOverride(itemKey, parsed);
        setEditingPriceKey(null);
    };

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
                        <div className="space-y-2">
                            {lineItems
                                .filter((item) => item.status !== "draft")
                                .map((item) => {
                                    // products is intentionally kept in props to preserve existing API and future use
                                    void products;

                                    const itemKey = item.tempId || item.id || "";
                                    const isPriceOverridden = !!item.priceOverridden && item.overriddenPrice != null;
                                    const isEditingPrice = !!itemKey && editingPriceKey === itemKey;

                                    const hasAttachmentOption = Array.isArray(item.productOptions)
                                        ? item.productOptions.some((opt) => opt.type === "attachment")
                                        : false;

                                    const showDimensions = item.width > 1 || item.height > 1;

                                    return (
                                        <div
                                            key={item.tempId || item.id}
                                            className="group flex gap-3 rounded-lg border border-border/60 bg-background/40 p-3 hover:bg-muted/30 transition-colors"
                                        >
                                            {/* Thumbnail / icon */}
                                            <div className="h-10 w-10 rounded-md bg-muted flex items-center justify-center shrink-0">
                                                <FileText className="h-5 w-5 text-muted-foreground" />
                                            </div>

                                            {/* Main content */}
                                            <div className="min-w-0 flex-1 space-y-1">
                                                <div className="flex items-start justify-between gap-3">
                                                    <div className="min-w-0">
                                                        <div className="font-medium text-sm truncate">{item.productName}</div>
                                                        {item.variantName && (
                                                            <div className="text-xs text-muted-foreground truncate">{item.variantName}</div>
                                                        )}
                                                    </div>

                                                    <div className="text-right shrink-0">
                                                        {readOnly || !itemKey ? (
                                                            <div className="space-y-1">
                                                                <div className="font-mono text-sm font-medium">${item.linePrice.toFixed(2)}</div>
                                                                {isPriceOverridden && (
                                                                    <div className="flex justify-end">
                                                                        <Badge
                                                                            variant="outline"
                                                                            className="text-[10px] py-0 border-amber-300 text-amber-700"
                                                                        >
                                                                            Overridden
                                                                        </Badge>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        ) : isEditingPrice ? (
                                                            <div className="space-y-1">
                                                                <Input
                                                                    value={editingPriceText}
                                                                    onChange={(e) => setEditingPriceText(e.target.value)}
                                                                    onBlur={() => commitEditingPrice(itemKey)}
                                                                    onKeyDown={(e) => {
                                                                        if (e.key === "Enter") {
                                                                            e.preventDefault();
                                                                            commitEditingPrice(itemKey);
                                                                        }
                                                                        if (e.key === "Escape") {
                                                                            e.preventDefault();
                                                                            setEditingPriceKey(null);
                                                                        }
                                                                    }}
                                                                    className={`h-8 w-28 text-right font-mono px-2 pr-7 ${isPriceOverridden ? "border-amber-300 focus-visible:ring-amber-400/40" : ""
                                                                        }`}
                                                                    inputMode="decimal"
                                                                    autoFocus
                                                                />
                                                                {isPriceOverridden && (
                                                                    <div className="flex justify-end">
                                                                        <Badge
                                                                            variant="outline"
                                                                            className="text-[10px] py-0 border-amber-300 text-amber-700"
                                                                        >
                                                                            Overridden
                                                                        </Badge>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        ) : (
                                                            <div className="space-y-1">
                                                                <div className="group/price flex justify-end">
                                                                    <button
                                                                        type="button"
                                                                        className={`relative h-8 w-28 rounded-md border px-2 pr-7 text-right font-mono text-sm font-medium bg-muted/20 transition-colors cursor-text
                                                                            hover:bg-muted/30 hover:border-border
                                                                            ${isPriceOverridden ? "border-amber-300 bg-amber-50/40 text-amber-800 hover:border-amber-400" : "border-border/60"}`}
                                                                        onClick={() => startEditingPrice(itemKey, item.linePrice)}
                                                                    >
                                                                        ${item.linePrice.toFixed(2)}

                                                                        {/* Hover affordance */}
                                                                        <Pencil className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 opacity-0 transition-opacity group-hover/price:opacity-60" />

                                                                        {/* Overridden: inline reset */}
                                                                        {isPriceOverridden && (
                                                                            <button
                                                                                type="button"
                                                                                aria-label="Reset overridden price"
                                                                                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-0.5 opacity-80 hover:opacity-100"
                                                                                onClick={(e) => {
                                                                                    e.preventDefault();
                                                                                    e.stopPropagation();
                                                                                    // TODO: log price override to audit log
                                                                                    setPriceOverride(itemKey, null);
                                                                                }}
                                                                            >
                                                                                <RotateCcw className="h-3.5 w-3.5" />
                                                                            </button>
                                                                        )}
                                                                    </button>
                                                                </div>

                                                                {isPriceOverridden && (
                                                                    <div className="flex justify-end">
                                                                        <Badge
                                                                            variant="outline"
                                                                            className="text-[10px] py-0 border-amber-300 text-amber-700"
                                                                        >
                                                                            Overridden
                                                                        </Badge>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>

                                                {item.selectedOptions && item.selectedOptions.length > 0 && (
                                                    <div className="flex flex-wrap gap-1">
                                                        {item.selectedOptions.slice(0, 6).map((opt: any, idx: number) => (
                                                            <Badge key={idx} variant="outline" className="text-[11px] py-0">
                                                                {opt.optionName}
                                                                {typeof opt.note === "string" && opt.note.trim() !== "" ? "*" : ""}
                                                            </Badge>
                                                        ))}
                                                        {item.selectedOptions.length > 6 && (
                                                            <Badge variant="outline" className="text-[11px] py-0">
                                                                +{item.selectedOptions.length - 6}
                                                            </Badge>
                                                        )}
                                                    </div>
                                                )}

                                                {item.selectedOptions && item.selectedOptions.some((o: any) => typeof o?.note === "string" && o.note.trim() !== "") && (
                                                    <div className="text-xs text-muted-foreground truncate">
                                                        {item.selectedOptions
                                                            .filter((o: any) => typeof o?.note === "string" && o.note.trim() !== "")
                                                            .slice(0, 2)
                                                            .map((o: any) => `${o.optionName}: ${String(o.note).trim()}`)
                                                            .join(" • ")}
                                                    </div>
                                                )}

                                                {item.notes && (
                                                    <div className="text-xs italic text-muted-foreground truncate">
                                                        {item.notes}
                                                    </div>
                                                )}

                                                {/* Inline metrics row */}
                                                <div className="grid grid-cols-3 gap-2 pt-1 text-xs">
                                                    <div className="flex items-center justify-between rounded-md bg-muted/40 px-2 py-1">
                                                        <span className="text-muted-foreground">Size</span>
                                                        <span className="font-mono">
                                                            {showDimensions ? `${item.width}"×${item.height}"` : "—"}
                                                        </span>
                                                    </div>
                                                    <div className="flex items-center justify-between rounded-md bg-muted/40 px-2 py-1">
                                                        <span className="text-muted-foreground">Qty</span>
                                                        <span className="font-mono">{item.quantity}</span>
                                                    </div>
                                                    <div className="flex items-center justify-between rounded-md bg-muted/40 px-2 py-1">
                                                        <span className="text-muted-foreground">Artwork</span>
                                                        <span>
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
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Row actions */}
                                            {!readOnly && (
                                                <div className="shrink-0 flex items-start">
                                                    <DropdownMenu>
                                                        <DropdownMenuTrigger asChild>
                                                            <Button
                                                                variant="ghost"
                                                                size="icon"
                                                                className="h-8 w-8 opacity-90 group-hover:opacity-100"
                                                                aria-label="Line item actions"
                                                            >
                                                                <ChevronDown className="w-4 h-4" />
                                                            </Button>
                                                        </DropdownMenuTrigger>
                                                        <DropdownMenuContent align="end">
                                                            <DropdownMenuItem
                                                                onClick={() => {
                                                                    if (item.id) onEdit(item.id);
                                                                }}
                                                            >
                                                                <Pencil className="w-4 h-4 mr-2" />
                                                                Edit
                                                            </DropdownMenuItem>
                                                            <DropdownMenuItem onClick={() => onDuplicate(item.tempId || item.id || "")}>
                                                                <Copy className="w-4 h-4 mr-2" />
                                                                Duplicate
                                                            </DropdownMenuItem>
                                                            <DropdownMenuItem
                                                                onClick={() => onRemove(item.tempId || item.id || "")}
                                                                className="text-destructive"
                                                            >
                                                                <Trash2 className="w-4 h-4 mr-2" />
                                                                Remove
                                                            </DropdownMenuItem>
                                                        </DropdownMenuContent>
                                                    </DropdownMenu>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                        </div>
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
