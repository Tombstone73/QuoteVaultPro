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

export function QuoteEditorPage() {
    const navigate = useNavigate();
    const state = useQuoteEditorState();

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
            <div className="container mx-auto p-6 space-y-4">
                <Skeleton className="h-10 w-64" />
                <div className="grid gap-4 md:grid-cols-[2fr,1fr]">
                    <div className="space-y-3">
                        <Skeleton className="h-9 w-full" />
                        <Skeleton className="h-9 w-full" />
                        <Skeleton className="h-40 w-full" />
                    </div>
                    <div className="space-y-3">
                        <Skeleton className="h-9 w-full" />
                        <Skeleton className="h-9 w-full" />
                        <Skeleton className="h-9 w-full" />
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
        <div className="max-w-7xl mx-auto space-y-3 px-4">
            {/* Header with navigation and actions */}
            <QuoteHeader
                quoteNumber={(state.quote as any)?.quoteNumber || ""}
                canSaveQuote={state.canSaveQuote}
                canConvertToOrder={state.canConvertToOrder}
                isSaving={state.isSaving}
                onBack={state.handlers.handleBack}
                onSave={handleSave}
                onConvertToOrder={() => setShowConvertDialog(true)}
                convertToOrderPending={state.convertToOrderHook?.isPending}
            />

            {/* 3-Column Cockpit Layout */}
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(280px,340px)_minmax(0,1fr)_minmax(280px,340px)]">

                {/* ═══════════════════════════════════════════════════════════════ */}
                {/* LEFT COLUMN: Customer & Logistics */}
                {/* ═══════════════════════════════════════════════════════════════ */}
                <div className="space-y-3 order-1 xl:order-1">
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
                        onDeliveryMethodChange={state.handlers.setDeliveryMethod}
                        onShippingAddressChange={state.handlers.updateShippingAddress}
                        onQuoteNotesChange={state.handlers.setQuoteNotes}
                        onCopyCustomerAddress={state.handlers.handleCopyCustomerAddress}
                    />
                </div>

                {/* ═══════════════════════════════════════════════════════════════ */}
                {/* CENTER COLUMN: Line Item Builder + Item List */}
                {/* ═══════════════════════════════════════════════════════════════ */}
                <div className="space-y-3 order-3 xl:order-2">
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

                    <LineItemsTable
                        lineItems={state.lineItems}
                        products={state.products}
                        quoteId={state.quoteId}
                        onEdit={state.handlers.editLineItem}
                        onDuplicate={state.handlers.duplicateLineItem}
                        onRemove={state.handlers.removeLineItem}
                        onOpenAttachments={handleOpenAttachments}
                    />
                </div>

                {/* ═══════════════════════════════════════════════════════════════ */}
                {/* RIGHT COLUMN: Summary & Totals */}
                {/* ═══════════════════════════════════════════════════════════════ */}
                <div className="space-y-3 order-2 xl:order-3">
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
                        onSave={handleSave}
                        onConvertToOrder={() => setShowConvertDialog(true)}
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
