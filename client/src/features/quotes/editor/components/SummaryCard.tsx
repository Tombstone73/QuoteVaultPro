import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Save, X, ArrowLeft, Ban, Mail, CheckCircle, Loader2, Download, Eye } from "lucide-react";
import { downloadFileFromUrl } from "@/lib/downloadFile";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { Label } from "@/components/ui/label";
import { resolveRecipientEmail } from "@/lib/emailRecipientHelper";
import { Checkbox } from "@/components/ui/checkbox";
import type { QuoteWorkflowState } from "@shared/quoteWorkflow";
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
    shippingCents?: number | null;
    deliveryMethod: string;
    selectedCustomer: CustomerWithContacts | undefined;
    selectedContactId?: string | null;
    pricingStale?: boolean;
    canSaveQuote: boolean;
    isSaving: boolean;
    hasUnsavedChanges?: boolean;
    canConvertToOrder?: boolean;
    convertToOrderPending?: boolean;
    readOnly?: boolean;
    showConvertToOrder?: boolean;
    showDiscard?: boolean;
    quoteId?: string | null;
    quoteNumber?: number | null;
    quoteStatus?: string | null;
    onSave: () => void;
    onSaveAndBack?: () => void;
    afterSaveNavigation?: AfterSaveNavigation;
    primaryActionLabel?: string;
    primaryActionSavingLabel?: string;
    onConvertToOrder: () => void;
    onDiscard: () => void;
    onCancelQuote?: () => void;
    onDiscountAmountChange: (next: number) => void;
    quoteTaxExempt?: boolean | null;
    quoteTaxRateOverride?: number | null;
    onQuoteTaxExemptChange?: (exempt: boolean | null) => void;
    onQuoteTaxRateOverrideChange?: (rate: number | null) => void;
    workflowState?: QuoteWorkflowState;
    requireApproval?: boolean;
    isInternalUser?: boolean;
    onApprove?: () => void;
    onApproveAndSend?: () => void;
    onRequestApproval?: () => void;
    isApproving?: boolean;
    isApprovingAndSending?: boolean;
    isRequestingApproval?: boolean;
};

export function SummaryCard({
    subtotal,
    taxAmount,
    grandTotal,
    effectiveTaxRate,
    discountAmount,
    shippingCents,
    deliveryMethod,
    selectedCustomer,
    selectedContactId,
    pricingStale = false,
    canSaveQuote,
    isSaving,
    hasUnsavedChanges = false,
    canConvertToOrder = true,
    convertToOrderPending,
    readOnly = false,
    showConvertToOrder = true,
    showDiscard = true,
    quoteId,
    quoteNumber,
    quoteStatus,
    onSave,
    onSaveAndBack,
    afterSaveNavigation = "stay",
    primaryActionLabel,
    primaryActionSavingLabel,
    onConvertToOrder,
    onDiscard,
    onCancelQuote,
    onDiscountAmountChange,
    quoteTaxExempt,
    quoteTaxRateOverride,
    onQuoteTaxExemptChange,
    onQuoteTaxRateOverrideChange,
    workflowState,
    requireApproval = false,
    isInternalUser = false,
    onApprove,
    onApproveAndSend,
    onRequestApproval,
    isApproving = false,
    isApprovingAndSending = false,
    isRequestingApproval = false,
}: SummaryCardProps) {
    const { toast } = useToast();
    const { user } = useAuth();
    const [showEmailDialog, setShowEmailDialog] = useState(false);
    const [recipientEmail, setRecipientEmail] = useState('');
    const [isSendingEmail, setIsSendingEmail] = useState(false);
    const [senderEmail, setSenderEmail] = useState<{ fromAddress: string; fromName: string } | null>(null);

    // Fetch sender email info when dialog opens
    useEffect(() => {
        if (showEmailDialog && !senderEmail) {
            fetch('/api/email/sender', {
                method: 'GET',
                credentials: 'include',
            })
                .then(res => res.json())
                .then(data => {
                    if (data.configured && data.fromAddress) {
                        setSenderEmail({ fromAddress: data.fromAddress, fromName: data.fromName || '' });
                    }
                })
                .catch(() => {
                    // Silent fail - sender info is optional
                });
        }
    }, [showEmailDialog, senderEmail]);

    // PDF URLs
    const quotePdfViewUrl = quoteId ? `/api/quotes/${encodeURIComponent(quoteId)}/pdf` : '';
    const quotePdfDownloadUrl = quoteId ? `/api/quotes/${encodeURIComponent(quoteId)}/pdf?download=1` : '';
    const quotePdfFilename = quoteNumber ? `Quote-${String(quoteNumber)}.pdf` : 'quote.pdf';

    const handleSendEmail = async () => {
        if (!quoteId || isSendingEmail) return;
        
        // Get selected contact from customer's contacts array
        const selectedContact = selectedCustomer?.contacts?.find(c => c.id === selectedContactId);
        
        // Resolve recipient: input value > contact email > customer email
        const resolved = resolveRecipientEmail({
            toInput: recipientEmail,
            contact: selectedContact,
            customer: selectedCustomer,
        });
        
        if (!resolved.email) {
            toast({
                title: 'No email address',
                description: 'Please enter a recipient email address.',
                variant: 'destructive',
            });
            return;
        }
        
        setIsSendingEmail(true);
        try {
            const response = await fetch(`/api/quotes/${quoteId}/email`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ to: emailToUse }),
            });
            const json = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(json?.error || 'Failed to send email');
            }
            toast({
                title: 'Email sent',
                description: `Quote sent to ${emailToUse}`,
            });
            setShowEmailDialog(false);
            setRecipientEmail('');
        } catch (err: any) {
            toast({
                title: 'Could not send email',
                description: err?.message || 'Please try again.',
                variant: 'destructive',
            });
        } finally {
            setIsSendingEmail(false);
        }
    };

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
    const showCancelQuote = hasQuoteNumber && quoteStatus === 'draft' && onCancelQuote;

    // Approval workflow logic (independent of Edit Mode)
    const isDraft = workflowState === 'draft';
    const isPendingApproval = workflowState === 'pending_approval';
    const isSent = workflowState === 'sent';
    
    // Draft state with approval required
    const showRequestApproval = requireApproval && isDraft && !isInternalUser;
    const showApprovalActions = requireApproval && (isDraft || isPendingApproval) && isInternalUser;
    
    // Pending approval state for non-approvers
    const showPendingApprovalHint = requireApproval && isPendingApproval && !isInternalUser;
    
    // Draft state for non-approvers
    const showApprovalRequiredHint = requireApproval && isDraft && !isInternalUser;
    
    // Hide Email Quote in draft/pending_approval when approval required
    const hideEmailInDraft = requireApproval && (isDraft || isPendingApproval);
    
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

                {/* Shipping (before Tax) */}
                {deliveryMethod !== 'pickup' && (
                    <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">
                            {deliveryMethod === 'deliver' ? 'Delivery' : 'Shipping'}
                        </span>
                        <span className="font-mono">
                            {shippingCents != null ? `$${(shippingCents / 100).toFixed(2)}` : <span className="text-muted-foreground">—</span>}
                        </span>
                    </div>
                )}

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

                <Separator className="my-4" />

                {/* Grand Total - emphasized */}
                <div className="flex justify-between items-baseline pt-2 pb-2">
                    <div className="flex items-center gap-2">
                        <span className="text-base font-semibold">Grand Total</span>
                        {pricingStale && (
                            <Badge variant="outline" className="text-[10px]">
                                Totals out of date
                            </Badge>
                        )}
                    </div>
                    <span className="text-3xl font-bold font-mono tracking-tight">${grandTotal.toFixed(2)}</span>
                </div>
            </CardContent>

            <CardFooter className="flex flex-col gap-2.5 pt-0 px-4 pb-4 border-t border-border/40">
                {!readOnly ? (
                    <>
                        {/* EDIT MODE */}
                        {/* Row 1: Save Changes */}
                        <Button
                            className="w-full h-10"
                            onClick={onSave}
                            disabled={!canSaveQuote || isSaving}
                        >
                            <Save className="w-4 h-4 mr-2" />
                            {primaryActionLabel
                                ? (isSaving ? (primaryActionSavingLabel || "Saving…") : primaryActionLabel)
                                : (isSaving
                                    ? "Saving…"
                                    : afterSaveNavigation === "back"
                                        ? "Save & Back"
                                        : "Save Changes")}
                        </Button>

                        {/* Row 2: Save & Back (conditional, only shown when preference is "stay") */}
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

                        {/* Row 3: Approval Workflow Actions */}
                        {showApprovalActions ? (
                            // Approvers see Approve + Approve & Send buttons
                            <>
                                <Button
                                    variant="default"
                                    className="w-full h-10"
                                    onClick={onApprove}
                                    disabled={isApproving || isApprovingAndSending || isSaving}
                                >
                                    {isApproving ? (
                                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                    ) : (
                                        <CheckCircle className="w-4 h-4 mr-2" />
                                    )}
                                    {isApproving ? "Approving…" : "Approve"}
                                </Button>
                                <Button
                                    variant="default"
                                    className="w-full h-10"
                                    onClick={onApproveAndSend}
                                    disabled={isApproving || isApprovingAndSending || isSaving}
                                >
                                    {isApprovingAndSending ? (
                                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                    ) : (
                                        <CheckCircle className="w-4 h-4 mr-2" />
                                    )}
                                    {isApprovingAndSending ? "Approving & Sending…" : "Approve & Send"}
                                </Button>
                            </>
                        ) : showRequestApproval ? (
                            // Non-approvers in draft state see Request Approval button
                            <>
                                <Button
                                    variant="default"
                                    className="w-full h-10"
                                    onClick={onRequestApproval}
                                    disabled={isRequestingApproval || isSaving}
                                >
                                    {isRequestingApproval ? (
                                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                    ) : (
                                        <CheckCircle className="w-4 h-4 mr-2" />
                                    )}
                                    {isRequestingApproval ? "Requesting…" : "Request Approval"}
                                </Button>
                                <div className="w-full p-2 text-xs text-muted-foreground bg-muted/50 rounded-md border border-border/40">
                                    💡 This quote requires approval before it can be sent to the customer.
                                </div>
                            </>
                        ) : showPendingApprovalHint ? (
                            // Non-approvers in pending_approval state see disabled state
                            <div className="w-full p-3 text-sm text-muted-foreground bg-muted/50 rounded-md border border-border/40">
                                ⏳ <strong>Pending Approval</strong> — Waiting for an authorized user to approve this quote.
                            </div>
                        ) : !hideEmailInDraft ? (
                            // Email Quote button (for sent/approved states or when approval not required)
                            <Button
                                variant="outline"
                                className="w-full h-10"
                                disabled
                            >
                                <Mail className="w-4 h-4 mr-2" />
                                Email Quote
                            </Button>
                        ) : null}

                        {/* Row 4: Cancel Quote (conditional, shown for quotes with numbers) */}
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

                        {/* Row 5: Small button row - Discard + Preview */}
                        <div className="grid grid-cols-2 gap-2 w-full">
                            {showDiscard && (
                                <TooltipProvider>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <span className="w-full">
                                                <Button
                                                    variant="outline"
                                                    className="w-full"
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
                            <Button
                                variant="outline"
                                className={`${!showDiscard ? "col-span-2" : ""} w-full`}
                                disabled
                            >
                                Preview
                            </Button>
                        </div>

                        {/* Row 6: Convert to Order (conditional) */}
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
                        {/* VIEW MODE */}
                        {/* Row 1: Email Quote + Preview + Download PDF */}
                        <div className="grid grid-cols-3 gap-2 w-full">
                            <Button
                                variant="outline"
                                className="w-full"
                                onClick={() => {
                                    setRecipientEmail('');
                                    setShowEmailDialog(true);
                                }}
                                disabled={!quoteId}
                            >
                                <Mail className="w-4 h-4 mr-2" />
                                Email
                            </Button>
                            <Button
                                variant="outline"
                                className="w-full"
                                onClick={() => window.open(quotePdfViewUrl, '_blank')}
                                disabled={!quoteId}
                            >
                                <Eye className="w-4 h-4 mr-2" />
                                Preview
                            </Button>
                            <Button
                                variant="outline"
                                className="w-full"
                                onClick={() => void downloadFileFromUrl(quotePdfDownloadUrl, quotePdfFilename)}
                                disabled={!quoteId}
                            >
                                <Download className="w-4 h-4 mr-2" />
                                PDF
                            </Button>
                        </div>

                        {/* Row 2: Convert to Order (primary action, full-width) */}
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
            
            {/* Email Dialog */}
            <Dialog open={showEmailDialog} onOpenChange={setShowEmailDialog}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Send Quote via Email</DialogTitle>
                        <DialogDescription>
                            Send this quote with PDF attachment
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        {/* From Address (Read-Only) */}
                        {senderEmail && (
                            <div className="space-y-2">
                                <Label className="text-sm text-muted-foreground">From (Configured Sender)</Label>
                                <div className="text-sm font-medium px-3 py-2 bg-muted/50 rounded-md border">
                                    {senderEmail.fromName ? `${senderEmail.fromName} <${senderEmail.fromAddress}>` : senderEmail.fromAddress}
                                </div>
                            </div>
                        )}
                        
                        {/* Reply-To (Read-Only, shown only for internal users with email) */}
                        {user && user.email && ['owner', 'admin', 'manager', 'employee'].includes(user.role || '') && (
                            <div className="space-y-2">
                                <Label className="text-sm text-muted-foreground">Reply-To</Label>
                                <div className="text-sm px-3 py-2 bg-muted/50 rounded-md border">
                                    {user.email}
                                </div>
                            </div>
                        )}
                        
                        {/* To Address */}
                        <div className="space-y-2">
                            <div className="flex items-center gap-2">
                                <Label htmlFor="email">To</Label>
                                {(() => {
                                    const selectedContact = selectedCustomer?.contacts?.find(c => c.id === selectedContactId);
                                    const resolved = resolveRecipientEmail({
                                        toInput: recipientEmail,
                                        contact: selectedContact,
                                        customer: selectedCustomer,
                                    });
                                    
                                    const sourceLabels = {
                                        entered: 'Entered',
                                        contact: 'Contact',
                                        customer: 'Customer',
                                        missing: null,
                                    };
                                    
                                    const sourceLabel = sourceLabels[resolved.source];
                                    
                                    return sourceLabel ? (
                                        <Badge variant={resolved.source === 'entered' ? 'default' : 'secondary'} className="text-xs">
                                            {sourceLabel}
                                        </Badge>
                                    ) : null;
                                })()}
                            </div>
                            <Input
                                id="email"
                                type="email"
                                placeholder={(() => {
                                    const selectedContact = selectedCustomer?.contacts?.find(c => c.id === selectedContactId);
                                    const resolved = resolveRecipientEmail({
                                        toInput: '',
                                        contact: selectedContact,
                                        customer: selectedCustomer,
                                    });
                                    return resolved.email || "customer@example.com";
                                })()}
                                value={recipientEmail}
                                onChange={(e) => setRecipientEmail(e.target.value)}
                                disabled={isSendingEmail}
                            />
                            {(() => {
                                const selectedContact = selectedCustomer?.contacts?.find(c => c.id === selectedContactId);
                                const resolved = resolveRecipientEmail({
                                    toInput: recipientEmail,
                                    contact: selectedContact,
                                    customer: selectedCustomer,
                                });
                                return resolved.source === 'missing' ? (
                                    <p className="text-sm text-destructive">
                                        No recipient email available. Please enter an email address.
                                    </p>
                                ) : null;
                            })()}
                        </div>
                    </div>
                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => setShowEmailDialog(false)}
                            disabled={isSendingEmail}
                        >
                            Cancel
                        </Button>
                        <Button
                            onClick={handleSendEmail}
                            disabled={(() => {
                                const selectedContact = selectedCustomer?.contacts?.find(c => c.id === selectedContactId);
                                const resolved = resolveRecipientEmail({
                                    toInput: recipientEmail,
                                    contact: selectedContact,
                                    customer: selectedCustomer,
                                });
                                return isSendingEmail || resolved.source === 'missing';
                            })()}
                        >
                            {isSendingEmail ? 'Sending...' : 'Send Email'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </Card>
    );
}
