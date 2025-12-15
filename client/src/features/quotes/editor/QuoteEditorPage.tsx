import { useEffect, useMemo, useState, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { ConvertQuoteToOrderDialog } from "@/components/convert-quote-to-order-dialog";
import { ROUTES } from "@/config/routes";
import { useQuoteEditorState } from "./useQuoteEditorState";
import { QuoteHeader } from "./components/QuoteHeader";
import { CustomerCard } from "./components/CustomerCard";
import { FulfillmentCard } from "./components/FulfillmentCard";
import { LineItemsSection } from "./components/LineItemsSection";
import { SummaryCard } from "./components/SummaryCard";
import type { CustomerSelectRef } from "@/components/CustomerSelect";

type QuoteEditorPageProps = {
    mode?: "view" | "edit";
};

export function QuoteEditorPage({ mode = "edit" }: QuoteEditorPageProps = {}) {
    // ALL HOOKS MUST BE CALLED UNCONDITIONALLY AT THE TOP
    const navigate = useNavigate();
    const location = useLocation();
    const state = useQuoteEditorState();

    // Edit Mode is a UI state (not per-section) and controls whether inputs render at all.
    const [editMode, setEditMode] = useState(mode !== "view");
    const readOnly = !editMode;

    // Expanded line item (accordion) state
    const [expandedKey, setExpandedKey] = useState<string | null>(null);

    // Dialog state (convert is still a dialog for now; core editing stays inline)
    const [showConvertDialog, setShowConvertDialog] = useState(false);

    // Ref for customer select to enable initial focus
    const customerSelectRef = useRef<CustomerSelectRef>(null);
    // Track if we've already attempted focus for current route to prevent re-runs
    const hasAttemptedFocusRef = useRef<string | null>(null);

    useEffect(() => {
        if (!editMode) setExpandedKey(null);
    }, [editMode]);

    // Reset focus attempt tracking when route changes
    useEffect(() => {
        hasAttemptedFocusRef.current = null;
    }, [location.pathname]);

    // Initial focus: focus customer search input on new quote/new order pages
    useEffect(() => {
        // Only attempt focus once per route
        if (hasAttemptedFocusRef.current === location.pathname) return;
        
        // Only focus if:
        // 1. Not read-only (edit mode)
        // 2. On new quote/new order route OR no customer selected yet
        // 3. User hasn't already focused something (activeElement is not an input/textarea/select/button)
        // 4. No dialog is open
        // 5. Not still loading initial quote data
        if (readOnly) return;
        if (showConvertDialog) return;
        if (state.isInitialQuoteLoading) return; // Wait for initial load to complete
        
        // Check if we're on a new quote/new order route
        const isNewRoute = location.pathname === ROUTES.quotes.new || location.pathname === ROUTES.orders.new;
        
        // Only focus on new routes or when customer is not selected
        const shouldFocus = isNewRoute || !state.selectedCustomerId;
        if (!shouldFocus) {
            hasAttemptedFocusRef.current = location.pathname; // Mark as attempted even if we don't focus
            return;
        }

        // Check if user has already focused something (skip if they have)
        const activeEl = document.activeElement;
        const isUserFocused = activeEl && activeEl !== document.body && (
            activeEl.tagName === 'INPUT' ||
            activeEl.tagName === 'TEXTAREA' ||
            activeEl.tagName === 'SELECT' ||
            activeEl.tagName === 'BUTTON' ||
            activeEl.getAttribute('role') === 'combobox' ||
            activeEl.getAttribute('contenteditable') === 'true'
        );

        if (isUserFocused) {
            hasAttemptedFocusRef.current = location.pathname;
            return;
        }

        // Mark that we've attempted focus for this route
        hasAttemptedFocusRef.current = location.pathname;

        // Use multiple animation frames + longer delay to ensure we focus after user menu/other components
        // This ensures the customer input gets focus after any header/menu components
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                setTimeout(() => {
                    // Double-check conditions haven't changed
                    if (readOnly || showConvertDialog) return;
                    const stillNewRoute = location.pathname === ROUTES.quotes.new || location.pathname === ROUTES.orders.new;
                    if (!stillNewRoute && state.selectedCustomerId) return;
                    
                    customerSelectRef.current?.focus();
                }, 250);
            });
        });
    }, [readOnly, showConvertDialog, state.isNewQuote, state.selectedCustomerId, state.isInitialQuoteLoading, location.pathname]);

    const lastUpdatedLabel = useMemo(() => {
        const q: any = state.quote as any;
        const raw = q?.updatedAt || q?.createdAt;
        if (!raw) return undefined;
        const t = new Date(raw).getTime();
        if (!Number.isFinite(t)) return undefined;
        const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
        if (mins <= 1) return "just now";
        if (mins < 60) return `${mins} mins ago`;
        const hours = Math.round(mins / 60);
        return `${hours} hr${hours !== 1 ? "s" : ""} ago`;
    }, [state.quote]);

    const updatedByLabel = useMemo(() => {
        const u: any = (state.quote as any)?.user;
        if (!u) return undefined;
        const name = `${u.firstName || ""} ${u.lastName || ""}`.trim();
        return name || u.email || undefined;
    }, [state.quote]);

    /**
     * Wrapper for save quote - saves and stays on the quote (no navigation)
     */
    const handleSave = async () => {
        try {
            await state.handlers.saveQuote();
            // Stay on the quote page after save (no navigation)
        } catch (err) {
            // Error handling is already done inside saveQuote (toast shown)
            console.error("[QuoteEditorPage] Save failed", err);
        }
    };

    /**
     * Save quote and navigate back to quotes list
     */
    const handleSaveAndBack = async () => {
        try {
            await state.handlers.saveQuote();
            navigate(ROUTES.quotes.list, { replace: true });
        } catch (err) {
            // Error handling is already done inside saveQuote (toast shown)
            console.error("[QuoteEditorPage] Save & Back failed", err);
        }
    };

    const handleDiscard = async () => {
        await state.handlers.discardAllChanges();
        setExpandedKey(null);
        setEditMode(false);
    };

    // EARLY RETURNS MUST COME AFTER ALL HOOKS
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

    return (
        <div className="min-h-screen bg-background">
            <div className="max-w-[1600px] mx-auto px-6 py-4">
                {/* Top bar: Back + Quote # + Status + Actions */}
                <QuoteHeader
                    quoteNumber={(state.quote as any)?.quoteNumber || ""}
                    quoteId={state.quoteId}
                    canDuplicateQuote={state.canDuplicateQuote}
                    isDuplicatingQuote={state.isDuplicatingQuote}
                    status={(state.quote as any)?.status}
                    editMode={editMode}
                    editModeDisabled={state.isSaving}
                    onBack={state.handlers.handleBack}
                    onDuplicateQuote={state.handlers.duplicateQuote}
                    onEditModeChange={(next) => setEditMode(next)}
                />

                {/* Two-column layout: Left (Customer + Line Items) | Right (Summary) */}
                <div className="grid gap-6 mt-6 lg:grid-cols-[1fr_400px]">
                    {/* LEFT COLUMN: Customer + Line Items */}
                    <div className="space-y-6">
                        {/* Customer & Details Panel */}
                        <CustomerCard
                            ref={customerSelectRef}
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
                            jobLabel={state.jobLabel}
                            requestedDueDate={state.requestedDueDate}
                            tags={state.tags}
                            onCustomerChange={state.handlers.setCustomer}
                            onContactChange={state.handlers.setContactId}
                            onJobLabelChange={state.handlers.setJobLabel}
                            onRequestedDueDateChange={state.handlers.setRequestedDueDate}
                            onAddTag={state.handlers.addTag}
                            onRemoveTag={state.handlers.removeTag}
                        />

                        {/* Line Items Section */}
                        <LineItemsSection
                            quoteId={state.quoteId}
                            readOnly={readOnly}
                            lineItems={state.lineItems}
                            products={state.products}
                            expandedKey={expandedKey}
                            onExpandedKeyChange={setExpandedKey}
                            onCreateDraftLineItem={state.handlers.createDraftLineItem}
                            onUpdateLineItem={state.handlers.updateLineItemLocal}
                            onSaveLineItem={state.handlers.saveLineItem}
                            onDuplicateLineItem={state.handlers.duplicateLineItem}
                            onRemoveLineItem={state.handlers.removeLineItem}
                        />
                    </div>

                    {/* RIGHT COLUMN: Fulfillment + Quote Summary + Actions */}
                    <div className="space-y-6 lg:sticky lg:top-4 h-fit">
                        {/* Fulfillment Panel */}
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

                        {/* Quote Summary */}
                        <SummaryCard
                            lineItems={state.lineItems}
                            products={state.products}
                            subtotal={state.subtotal}
                            taxAmount={state.taxAmount}
                            grandTotal={state.grandTotal}
                            effectiveTaxRate={state.effectiveTaxRate}
                            discountAmount={state.discountAmount}
                            deliveryMethod={state.deliveryMethod}
                            selectedCustomer={state.selectedCustomer}
                            canSaveQuote={state.canSaveQuote}
                            isSaving={state.isSaving}
                            hasUnsavedChanges={state.hasUnsavedChanges}
                            readOnly={readOnly}
                            onSave={handleSave}
                            onSaveAndBack={handleSaveAndBack}
                            onConvertToOrder={() => setShowConvertDialog(true)}
                            canConvertToOrder={state.canConvertToOrder}
                            convertToOrderPending={state.convertToOrderHook?.isPending}
                            showConvertToOrder={!editMode && !!state.quoteId}
                            onDiscard={handleDiscard}
                            onDiscountAmountChange={state.handlers.setDiscountAmount}
                            quoteTaxExempt={state.quoteTaxExempt}
                            quoteTaxRateOverride={state.quoteTaxRateOverride}
                            onQuoteTaxExemptChange={state.handlers.setQuoteTaxExempt}
                            onQuoteTaxRateOverrideChange={state.handlers.setQuoteTaxRateOverride}
                        />
                    </div>
                </div>
            </div>

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
