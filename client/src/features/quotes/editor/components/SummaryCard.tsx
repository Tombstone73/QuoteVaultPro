import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { DollarSign, Save } from "lucide-react";
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
    canConvertToOrder?: boolean;
    convertToOrderPending?: boolean;
    readOnly?: boolean;
    onSave: () => void;
    onConvertToOrder: () => void;
};

export function SummaryCard({
    subtotal,
    taxAmount,
    grandTotal,
    effectiveTaxRate,
    discountPercent,
    deliveryMethod,
    selectedCustomer,
    canSaveQuote,
    isSaving,
    canConvertToOrder = true,
    convertToOrderPending,
    readOnly = false,
    onSave,
    onConvertToOrder,
}: SummaryCardProps) {
    return (
        <Card className="rounded-xl bg-card/70 border-border/60 shadow-lg">
            <CardHeader className="pb-2 px-5 pt-4">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <DollarSign className="w-4 h-4" />
                    Quote Summary
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 px-5 pb-4">
                <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Subtotal</span>
                    <span className="font-mono">${subtotal.toFixed(2)}</span>
                </div>

                {discountPercent && discountPercent > 0 && (
                    <div className="flex justify-between text-sm text-green-600">
                        <span>Discount ({discountPercent}%)</span>
                        <span className="font-mono">-${(subtotal * discountPercent / 100).toFixed(2)}</span>
                    </div>
                )}

                <Separator />

                <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">
                        Tax ({(effectiveTaxRate * 100).toFixed(2)}%)
                        {selectedCustomer?.isTaxExempt && (
                            <Badge variant="outline" className="ml-2 text-xs">Exempt</Badge>
                        )}
                    </span>
                    <span className="font-mono">${taxAmount.toFixed(2)}</span>
                </div>

                {deliveryMethod === 'ship' && (
                    <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Shipping</span>
                        <span className="font-mono text-muted-foreground">TBD</span>
                    </div>
                )}

                <Separator />

                <div className="flex justify-between items-baseline pt-1">
                    <span className="font-semibold">Grand Total</span>
                    <span className="text-2xl font-bold font-mono">${grandTotal.toFixed(2)}</span>
                </div>
            </CardContent>

            <CardFooter className="flex flex-col gap-3 pt-0 px-5 pb-4">
                {!readOnly ? (
                    <>
                        {/* Row 1: Save (edit mode only) */}
                        {!readOnly && (
                            <Button
                                className="w-full h-10"
                                onClick={onSave}
                                disabled={!canSaveQuote || isSaving}
                            >
                                <Save className="w-4 h-4 mr-2" />
                                {isSaving ? "Saving…" : "Save Changes"}
                            </Button>
                        )}

                        {/* Row 2: Email + Preview (Preview full-width in view mode) */}
                        <div className="grid grid-cols-2 gap-2 w-full">
                            {!readOnly && (
                                <Button variant="outline" className="w-full" disabled>
                                    Email Quote
                                </Button>
                            )}
                            <Button
                                variant="outline"
                                className={`${readOnly ? "col-span-2" : ""} w-full`}
                                disabled
                            >
                                Preview
                            </Button>
                        </div>

                        {/* Row 3: Convert (both modes) */}
                        <Button
                            variant={readOnly ? "default" : "secondary"}
                            className="w-full h-10"
                            onClick={onConvertToOrder}
                            disabled={!canConvertToOrder || !!convertToOrderPending || isSaving}
                        >
                            {convertToOrderPending ? "Converting…" : "Convert to Order"}
                        </Button>
                    </>
                ) : (
                    <>
                        <Button variant="outline" className="w-full h-10" disabled>
                            Email Quote
                        </Button>

                        <Button variant="outline" className="w-full h-10" disabled>
                            Preview
                        </Button>

                        <Button
                            variant="default"
                            className="w-full h-10"
                            onClick={onConvertToOrder}
                            disabled={!canConvertToOrder || !!convertToOrderPending || isSaving}
                        >
                            {convertToOrderPending ? "Converting…" : "Convert to Order"}
                        </Button>
                    </>
                )}
            </CardFooter>
        </Card>
    );
}
