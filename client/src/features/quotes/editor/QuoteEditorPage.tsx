import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConvertQuoteToOrderDialog } from "@/components/convert-quote-to-order-dialog";
import { LineItemAttachmentsPanel } from "@/components/LineItemAttachmentsPanel";
import { ROUTES } from "@/config/routes";
import { useQuoteEditorState } from "./useQuoteEditorState";
import { QuoteHeader } from "./components/QuoteHeader";
import { CustomerCard } from "./components/CustomerCard";
import { FulfillmentCard } from "./components/FulfillmentCard";
import { LineItemBuilder } from "./components/LineItemBuilder";
import { LineItemsTable } from "./components/LineItemsTable";
import { SummaryCard } from "./components/SummaryCard";
import type { QuoteLineItemDraft } from "./types";

type QuoteEditorPageProps = {
    mode?: "view" | "edit";
};

export function QuoteEditorPage({ mode = "edit" }: QuoteEditorPageProps = {}) {
    const navigate = useNavigate();
    const state = useQuoteEditorState();

    // Derive read-only flag from mode
    const readOnly = mode === "view";

    // Dialog state
    const [showConvertDialog, setShowConvertDialog] = useState(false);
    const [attachmentsItem, setAttachmentsItem] = useState<QuoteLineItemDraft | null>(null);
    const [attachmentsOpen, setAttachmentsOpen] = useState(false);

    // Permission check
    if (!state.isInternalUser) {
        return (
            <div className="container mx-auto p-6">
                <Card>
                    <CardContent className="py-16 text-center">
                        <p className="text-muted-foreground">Access denied. This page is for internal staff only.</p>
                    </CardContent>
                </Card>
            </div>
        );
    }

    // Show loading placeholder only for initial load of a valid quoteId
    if (state.isInitialQuoteLoading && !state.isQuoteRefreshing) {
        return (
            <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
                <div className="space-y-3">
                    <Skeleton className="h-8 w-40" />
                    <Skeleton className="h-10 w-64" />
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                    <Skeleton className="h-44 w-full" />
                    <Skeleton className="h-44 w-full" />
                </div>
                <div className="grid gap-6 md:grid-cols-[2fr_1fr]">
                    <div className="space-y-4">
                        <Skeleton className="h-10 w-48" />
                        <Skeleton className="h-56 w-full" />
                        <Skeleton className="h-40 w-full" />
                    </div>
                    <div className="space-y-4">
                        <Skeleton className="h-72 w-full" />
                    </div>
                </div>
            </div>
        );
    }

    /**
     * Wrapper for save quote that handles navigation based on result
     */
    const handleSave = async () => {
        try {
            const result = await state.handlers.saveQuote();

            if (result.kind === "created") {
                // New quote created - redirect to quotes list
                navigate(ROUTES.quotes.list, { replace: true });
            }
            // For "updated" quotes, stay on the current page (no navigation)
        } catch (err) {
            // Error handling is already done inside saveQuote (toast shown)
            console.error("[QuoteEditorPage] Save failed", err);
        }
    };

    const handleOpenAttachments = (item: QuoteLineItemDraft) => {
        if (!item.id) return;
        setAttachmentsItem(item);
        setAttachmentsOpen(true);
    };

    const handleCloseAttachments = () => {
        setAttachmentsOpen(false);
        setAttachmentsItem(null);
    };

    return (
        <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
            {/* Top header (full width): back link + quote header */}
            <QuoteHeader
                quoteNumber={(state.quote as any)?.quoteNumber || ""}
                quoteId={state.quoteId}
                canSaveQuote={state.canSaveQuote}
                canConvertToOrder={state.canConvertToOrder}
                isSaving={state.isSaving}
                readOnly={readOnly}
                onBack={state.handlers.handleBack}
                onSave={handleSave}
                onConvertToOrder={() => setShowConvertDialog(true)}
                convertToOrderPending={state.convertToOrderHook?.isPending}
            />

            {/* Customer / job meta (full width) */}
            <div className="grid gap-6 md:grid-cols-2">
                <CustomerCard
                    selectedCustomerId={state.selectedCustomerId}
                    selectedCustomer={state.selectedCustomer}
                    selectedContactId={state.selectedContactId}
                    contacts={state.contacts}
                    effectiveTaxRate={state.effectiveTaxRate}
                    pricingTier={state.pricingTier}
                    discountPercent={state.discountPercent}
                    markupPercent={state.markupPercent}
                    marginPercent={state.marginPercent}
                    deliveryMethod={state.deliveryMethod}
                    readOnly={readOnly}
                    onCustomerChange={state.handlers.setCustomer}
                    onContactChange={state.handlers.setContactId}
                />

                <FulfillmentCard
                    deliveryMethod={state.deliveryMethod}
                    shippingAddress={state.shippingAddress}
                    quoteNotes={state.quoteNotes}
                    selectedCustomer={state.selectedCustomer}
                    useCustomerAddress={state.useCustomerAddress}
                    customerHasAddress={!!state.customerHasAddress}
                    readOnly={readOnly}
                    onDeliveryMethodChange={state.handlers.setDeliveryMethod}
                    onShippingAddressChange={state.handlers.updateShippingAddress}
                    onQuoteNotesChange={state.handlers.setQuoteNotes}
                    onCopyCustomerAddress={state.handlers.handleCopyCustomerAddress}
                />
            </div>

            {/* Main content area (2-column on desktop, stacked on mobile) */}
            <div className="grid gap-6 md:grid-cols-[2fr_1fr]">
                {/* Left: Line Items */}
                <div className="space-y-6">
                    <LineItemsTable
                        lineItems={state.lineItems}
                        products={state.products}
                        quoteId={state.quoteId}
                        readOnly={readOnly}
                        onEdit={state.handlers.editLineItem}
                        onDuplicate={state.handlers.duplicateLineItem}
                        onRemove={state.handlers.removeLineItem}
                        onOpenAttachments={handleOpenAttachments}
                        onSetLineItemPriceOverride={state.handlers.setLineItemPriceOverride}
                    />

                    {/* Builder sits below the list; hidden in view mode */}
                    {!readOnly && (
                        <LineItemBuilder
                            products={state.products}
                            selectedProductId={state.selectedProductId}
                            selectedProduct={state.selectedProduct}
                            selectedVariantId={state.selectedVariantId}
                            productVariants={state.productVariants}
                            width={state.width}
                            height={state.height}
                            quantity={state.quantity}
                            calculatedPrice={state.calculatedPrice}
                            isCalculating={state.isCalculating}
                            calcError={state.calcError}
                            optionSelections={state.optionSelections}
                            lineItemNotes={state.lineItemNotes}
                            requiresDimensions={state.requiresDimensions}
                            productOptions={state.productOptions}
                            hasAttachmentOption={state.hasAttachmentOption}
                            productSearchOpen={state.productSearchOpen}
                            productSearchQuery={state.productSearchQuery}
                            filteredProducts={state.filteredProducts}
                            onProductSelect={state.handlers.setSelectedProductId}
                            onVariantSelect={state.handlers.setSelectedVariantId}
                            onWidthChange={state.handlers.setWidth}
                            onHeightChange={state.handlers.setHeight}
                            onQuantityChange={state.handlers.setQuantity}
                            onOptionSelectionsChange={state.handlers.setOptionSelections}
                            onLineItemNotesChange={state.handlers.setLineItemNotes}
                            onAddLineItem={state.handlers.addLineItem}
                            onProductSearchOpenChange={state.handlers.setProductSearchOpen}
                            onProductSearchQueryChange={state.handlers.setProductSearchQuery}
                        />
                    )}
                </div>

                {/* Right: Summary */}
                <div className="md:sticky md:top-6 h-fit">
                    <SummaryCard
                        lineItems={state.lineItems}
                        products={state.products}
                        subtotal={state.subtotal}
                        taxAmount={state.taxAmount}
                        grandTotal={state.grandTotal}
                        effectiveTaxRate={state.effectiveTaxRate}
                        discountPercent={state.discountPercent}
                        deliveryMethod={state.deliveryMethod}
                        selectedCustomer={state.selectedCustomer}
                        canSaveQuote={state.canSaveQuote}
                        isSaving={state.isSaving}
                        readOnly={readOnly}
                        onSave={handleSave}
                        onConvertToOrder={() => setShowConvertDialog(true)}
                        canConvertToOrder={state.canConvertToOrder}
                        convertToOrderPending={state.convertToOrderHook?.isPending}
                    />
                </div>
            </div>

            {/* Artwork Attachments Dialog */}
            <Dialog
                open={attachmentsOpen}
                onOpenChange={(open) => {
                    if (!open) {
                        handleCloseAttachments();
                    } else {
                        setAttachmentsOpen(true);
                    }
                }}
            >
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle>Artwork Attachments</DialogTitle>
                        {attachmentsItem?.productName && (
                            <DialogDescription>
                                {attachmentsItem.productName}
                            </DialogDescription>
                        )}
                    </DialogHeader>
                    <LineItemAttachmentsPanel
                        quoteId={state.quoteId}
                        lineItemId={attachmentsItem?.id}
                        productName={attachmentsItem?.productName}
                        defaultExpanded
                    />
                </DialogContent>
            </Dialog>

            {/* Convert to Order Dialog */}
            <ConvertQuoteToOrderDialog
                open={showConvertDialog}
                onOpenChange={setShowConvertDialog}
                isLoading={state.convertToOrderHook?.isPending}
                onSubmit={state.handlers.convertToOrder}
            />
        </div>
    );
}
