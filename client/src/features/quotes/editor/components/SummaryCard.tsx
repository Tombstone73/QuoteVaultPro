import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Save, X, ArrowLeft, Ban } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Product } from "@shared/schema";
import type { QuoteLineItemDraft } from "../types";
import type { CustomerWithContacts } from "@/components/CustomerSelect";
import type { AfterSaveNavigation } from "@/hooks/useUserPreferences";

type SummaryCardProps = {
    lineItems: QuoteLineItemDraft[];
    products: Product[];
    subtotal: number;
    taxAmount: number;
    grandTotal: number;
    effectiveTaxRate: number;
    discountAmount: number;
    deliveryMethod: string;
    selectedCustomer: CustomerWithContacts | undefined;
    canSaveQuote: boolean;
    isSaving: boolean;
    hasUnsavedChanges?: boolean;
    canConvertToOrder?: boolean;
    convertToOrderPending?: boolean;
    readOnly?: boolean;
    showConvertToOrder?: boolean;
    showDiscard?: boolean;
    quoteNumber?: number | null;
    quoteStatus?: string | null;
    onSave: () => void;
    onSaveAndBack?: () => void;
    afterSaveNavigation?: AfterSaveNavigation;
    onConvertToOrder: () => void;
    onDiscard: () => void;
    onCancelQuote?: () => void;
    onDiscountAmountChange: (next: number) => void;
    quoteTaxExempt?: boolean | null;
    quoteTaxRateOverride?: number | null;
    onQuoteTaxExemptChange?: (exempt: boolean | null) => void;
    onQuoteTaxRateOverrideChange?: (rate: number | null) => void;
};

export function SummaryCard({
    subtotal,
    taxAmount,
    grandTotal,
    effectiveTaxRate,
    discountAmount,
    deliveryMethod,
    selectedCustomer,
    canSaveQuote,
    isSaving,
    hasUnsavedChanges = false,
    canConvertToOrder = true,
    convertToOrderPending,
    readOnly = false,
    showConvertToOrder = true,
    showDiscard = true,
    quoteNumber,
    quoteStatus,
    onSave,
    onSaveAndBack,
    afterSaveNavigation = "stay",
    onConvertToOrder,
    onDiscard,
    onCancelQuote,
    onDiscountAmountChange,
    quoteTaxExempt,
    quoteTaxRateOverride,
    onQuoteTaxExemptChange,
    onQuoteTaxRateOverrideChange,
}: SummaryCardProps) {
    const [showTaxOverride, setShowTaxOverride] = useState(false);
    const safeDiscount = Number.isFinite(discountAmount) ? Math.max(0, discountAmount) : 0;
    const isTaxExempt = quoteTaxExempt === true || (quoteTaxExempt === null && selectedCustomer?.isTaxExempt);
    const displayTaxRate = quoteTaxRateOverride != null 
        ? quoteTaxRateOverride 
        : (selectedCustomer?.taxRateOverride != null 
            ? Number(selectedCustomer.taxRateOverride) 
            : effectiveTaxRate);
    
    // Determine if quote has a number assigned (fail-soft)
    const hasQuoteNumber = Boolean(quoteNumber);
    
    // Only show Cancel button for quotes with numbers that are drafts
    const showCancelQuote = hasQuoteNumber && quoteStatus === 'draft' && !readOnly && !!onCancelQuote;
    
    return (
        <Card className="rounded-lg border border-border/40 bg-card/50">
            <CardContent className="space-y-4 px-4 py-3 pt-4">
                <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Subtotal</span>
                    <span className="font-mono font-medium">${subtotal.toFixed(2)}</span>
                </div>

                <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Discount</span>
                    {readOnly ? (
                        <span className={safeDiscount > 0 ? "font-mono text-green-600" : "font-mono text-muted-foreground"}>
                            {safeDiscount > 0 ? `-${safeDiscount.toFixed(2)}` : "—"}
                        </span>
                    ) : (
                        <div className="w-28">
                            <Input
                                value={safeDiscount === 0 ? "" : String(safeDiscount.toFixed(2))}
                                onChange={(e) => {
                                    const raw = e.target.value.replace(/[$,]/g, "").trim();
                                    const n = raw === "" ? 0 : Number.parseFloat(raw);
                                    onDiscountAmountChange(Number.isFinite(n) ? Math.max(0, n) : 0);
                                }}
                                placeholder="0.00"
                                className="h-8 text-right font-mono"
                                inputMode="decimal"
                            />
                        </div>
                    )}
                </div>

                <Separator />

                <div className="flex justify-between items-center text-sm">
                    <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">
                            Tax ({(displayTaxRate * 100).toFixed(2)}%)
                            {isTaxExempt && (
                                <Badge variant="outline" className="ml-2 text-xs">Exempt</Badge>
                            )}
                        </span>
                        {!readOnly && (
                            <button
                                type="button"
                                onClick={() => setShowTaxOverride(!showTaxOverride)}
                                className="text-xs text-muted-foreground hover:text-foreground underline"
                            >
                                {showTaxOverride ? "Hide" : "Override"}
                            </button>
                        )}
                    </div>
                    <span className="font-mono">${taxAmount.toFixed(2)}</span>
                </div>
                {!readOnly && showTaxOverride && (
                    <div className="pl-4 space-y-2 border-l-2 border-border/50">
                        <div className="flex items-center gap-2">
                            <Checkbox
                                id="tax-exempt-override"
                                checked={quoteTaxExempt === true}
                                onCheckedChange={(checked) => {
                                    onQuoteTaxExemptChange?.(checked === true ? true : null);
                                    if (checked === true) {
                                        onQuoteTaxRateOverrideChange?.(null);
                                    }
                                }}
                            />
                            <Label htmlFor="tax-exempt-override" className="text-xs cursor-pointer">
                                Tax Exempt
                            </Label>
                        </div>
                        {quoteTaxExempt !== true && (
                            <div className="space-y-1">
                                <Label className="text-xs text-muted-foreground">Tax Rate Override</Label>
                                <Input
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    max="30"
                                    value={quoteTaxRateOverride != null ? (quoteTaxRateOverride * 100).toFixed(2) : ""}
                                    onChange={(e) => {
                                        const val = e.target.value;
                                        if (val === "") {
                                            onQuoteTaxRateOverrideChange?.(null);
                                        } else {
                                            const num = Number.parseFloat(val) / 100;
                                            if (Number.isFinite(num) && num >= 0 && num <= 0.30) {
                                                onQuoteTaxRateOverrideChange?.(num);
                                            }
                                        }
                                    }}
                                    placeholder="0.00"
                                    className="h-8 text-xs"
                                />
                            </div>
                        )}
                        {(quoteTaxExempt === true || quoteTaxRateOverride != null) && (
                            <button
                                type="button"
                                onClick={() => {
                                    onQuoteTaxExemptChange?.(null);
                                    onQuoteTaxRateOverrideChange?.(null);
                                }}
                                className="text-xs text-muted-foreground hover:text-foreground underline"
                            >
                                Clear
                            </button>
                        )}
                    </div>
                )}

                {deliveryMethod === 'ship' && (
                    <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Shipping</span>
                        <span className="font-mono text-muted-foreground">TBD</span>
                    </div>
                )}

                <Separator className="my-4" />

                {/* Grand Total - emphasized */}
                <div className="flex justify-between items-baseline pt-2 pb-2">
                    <span className="text-base font-semibold">Grand Total</span>
                    <span className="text-3xl font-bold font-mono tracking-tight">${grandTotal.toFixed(2)}</span>
                </div>
            </CardContent>

            <CardFooter className="flex flex-col gap-2.5 pt-0 px-4 pb-4 border-t border-border/40">
                {!readOnly ? (
                    <>
                        {/* Row 1: Save (edit mode only) */}
                        <Button
                            className="w-full h-10"
                            onClick={onSave}
                            disabled={!canSaveQuote || isSaving}
                        >
                            <Save className="w-4 h-4 mr-2" />
                            {isSaving 
                                ? "Saving…" 
                                : afterSaveNavigation === "back" 
                                    ? "Save & Back" 
                                    : "Save Changes"}
                        </Button>

                        {/* Optional Save & Back button (only shown when preference is "stay") */}
                        {onSaveAndBack && afterSaveNavigation === "stay" && (
                            <Button
                                variant="outline"
                                className="w-full h-10"
                                onClick={onSaveAndBack}
                                disabled={!canSaveQuote || isSaving}
                            >
                                <ArrowLeft className="w-4 h-4 mr-2" />
                                {isSaving ? "Saving…" : "Save & Back"}
                            </Button>
                        )}

                        {/* Discard button - disabled when quote number exists */}
                        {showDiscard && (
                            <TooltipProvider>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <span className="w-full">
                                            <Button
                                                variant="outline"
                                                className="w-full h-10"
                                                onClick={onDiscard}
                                                disabled={isSaving || hasQuoteNumber}
                                            >
                                                <X className="w-4 h-4 mr-2" />
                                                Discard
                                            </Button>
                                        </span>
                                    </TooltipTrigger>
                                    {hasQuoteNumber && (
                                        <TooltipContent>
                                            <p className="text-xs">Quote number assigned. Use Cancel Quote to keep an audit trail.</p>
                                        </TooltipContent>
                                    )}
                                </Tooltip>
                            </TooltipProvider>
                        )}

                        {/* Cancel Quote button - shown for quotes with numbers */}
                        {showCancelQuote && (
                            <Button
                                variant="destructive"
                                className="w-full h-10"
                                onClick={onCancelQuote}
                                disabled={isSaving}
                            >
                                <Ban className="w-4 h-4 mr-2" />
                                Cancel Quote
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
                        {showConvertToOrder && (
                            <Button
                                variant="secondary"
                                className="w-full h-10"
                                onClick={onConvertToOrder}
                                disabled={!canConvertToOrder || !!convertToOrderPending || isSaving}
                            >
                                {convertToOrderPending ? "Converting…" : "Convert to Order"}
                            </Button>
                        )}
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
