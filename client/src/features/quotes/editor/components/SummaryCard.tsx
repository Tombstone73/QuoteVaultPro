import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { DollarSign, Save, Send, ListOrdered } from "lucide-react";
import type { Product } from "@shared/schema";
import type { QuoteLineItemDraft } from "../types";
import type { CustomerWithContacts } from "@/components/CustomerSelect";

type SummaryCardProps = {
    lineItems: QuoteLineItemDraft[];
    products: Product[];
    subtotal: number;
    taxAmount: number;
    grandTotal: number;
    effectiveTaxRate: number;
    discountPercent: number | null;
    deliveryMethod: string;
    selectedCustomer: CustomerWithContacts | undefined;
    canSaveQuote: boolean;
    isSaving: boolean;
    onSave: () => void;
    onConvertToOrder: () => void;
};

export function SummaryCard({
    lineItems,
    products,
    subtotal,
    taxAmount,
    grandTotal,
    effectiveTaxRate,
    discountPercent,
    deliveryMethod,
    selectedCustomer,
    canSaveQuote,
    isSaving,
    onSave,
    onConvertToOrder,
}: SummaryCardProps) {
    return (
        <div className="space-y-3">
            {/* Finished Line Items Card - compact view */}
            {lineItems.length > 0 && (
                <Card className="rounded-xl bg-card/80 border-border/60 shadow-md">
                    <CardHeader className="pb-2 px-5 pt-4">
                        <CardTitle className="text-sm font-medium flex items-center gap-2">
                            <ListOrdered className="w-4 h-4" />
                            Line Items ({lineItems.length})
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="p-0">
                        <div className="divide-y max-h-[300px] overflow-y-auto">
                            {lineItems.map((item, index) => (
                                <div key={index} className="px-4 py-2 hover:bg-muted/50 transition-colors">
                                    <div className="flex justify-between items-start gap-2">
                                        <div className="flex-1 min-w-0">
                                            <p className="font-medium text-sm truncate">
                                                {products?.find((p: any) => p.id === item.productId)?.name || 'Unknown Product'}
                                            </p>
                                            {(item as any).description && (
                                                <p className="text-xs text-muted-foreground truncate">{(item as any).description}</p>
                                            )}
                                            {(item.width || item.height) && (
                                                <p className="text-xs text-muted-foreground">
                                                    {item.width}" × {item.height}"
                                                </p>
                                            )}
                                        </div>
                                        <div className="text-right shrink-0">
                                            <p className="font-mono text-sm font-medium">${Number((item as any).lineTotal || 0).toFixed(2)}</p>
                                            <p className="text-xs text-muted-foreground">Qty: {item.quantity}</p>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Quote Summary Card */}
            <Card className="rounded-xl bg-card/70 border-border/60 shadow-lg">
                <CardHeader className="pb-2 px-5 pt-4">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                        <DollarSign className="w-4 h-4" />
                        Quote Summary
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 px-5 pb-4">
                    {/* Subtotal */}
                    <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Subtotal</span>
                        <span className="font-mono">${subtotal.toFixed(2)}</span>
                    </div>

                    {/* Discounts - show if customer has discount */}
                    {discountPercent && discountPercent > 0 && (
                        <div className="flex justify-between text-sm text-green-600">
                            <span>Discount ({discountPercent}%)</span>
                            <span className="font-mono">-${(subtotal * discountPercent / 100).toFixed(2)}</span>
                        </div>
                    )}

                    <Separator />

                    {/* Tax breakdown */}
                    <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">
                            Tax ({(effectiveTaxRate * 100).toFixed(2)}%)
                            {selectedCustomer?.isTaxExempt && (
                                <Badge variant="outline" className="ml-2 text-xs">Exempt</Badge>
                            )}
                        </span>
                        <span className="font-mono">${taxAmount.toFixed(2)}</span>
                    </div>

                    {/* Shipping placeholder - to be implemented */}
                    {deliveryMethod === 'ship' && (
                        <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">Shipping</span>
                            <span className="font-mono text-muted-foreground">TBD</span>
                        </div>
                    )}

                    <Separator />

                    {/* Grand Total */}
                    <div className="flex justify-between items-baseline pt-1">
                        <span className="font-semibold">Grand Total</span>
                        <span className="text-2xl font-bold font-mono">${grandTotal.toFixed(2)}</span>
                    </div>
                </CardContent>
                <CardFooter className="flex-col gap-2 pt-0 px-5 pb-4">
                    <Button
                        className="w-full h-10"
                        onClick={onSave}
                        disabled={!canSaveQuote}
                    >
                        <Save className="w-4 h-4 mr-2" />
                        {isSaving ? "Saving…" : "Save Quote"}
                    </Button>
                    <div className="grid grid-cols-2 gap-2 w-full">
                        <Button variant="outline" disabled size="sm">
                            <Send className="w-4 h-4 mr-2" />
                            Email
                        </Button>
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={onConvertToOrder}
                            disabled={isSaving}
                        >
                            Convert to Order
                        </Button>
                    </div>
                </CardFooter>
            </Card>

            {/* Quick Info Card - only when customer selected */}
            {selectedCustomer && (
                <Card className="rounded-xl bg-card/80 border-border/60 shadow-md">
                    <CardHeader className="pb-2 px-5 pt-4">
                        <CardTitle className="text-xs font-medium text-muted-foreground">Customer Info</CardTitle>
                    </CardHeader>
                    <CardContent className="text-sm space-y-1 px-5 pb-4">
                        <p className="font-medium">{selectedCustomer.companyName}</p>
                        {selectedCustomer.email && (
                            <p className="text-muted-foreground text-xs">{selectedCustomer.email}</p>
                        )}
                        {selectedCustomer.phone && (
                            <p className="text-muted-foreground text-xs">{selectedCustomer.phone}</p>
                        )}
                    </CardContent>
                </Card>
            )}
        </div>
    );
}
