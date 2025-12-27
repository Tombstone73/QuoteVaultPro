import { useEffect, useMemo, useState, useRef, useContext } from "react";
import { useNavigate, useLocation, UNSAFE_NavigationContext } from "react-router-dom";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConvertQuoteToOrderDialog } from "@/components/convert-quote-to-order-dialog";
import { ROUTES } from "@/config/routes";
import { useUserPreferences } from "@/hooks/useUserPreferences";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useQuoteEditorState } from "./useQuoteEditorState";
import { QuoteHeader } from "./components/QuoteHeader";
import { CustomerCard } from "./components/CustomerCard";
import { FulfillmentCard } from "./components/FulfillmentCard";
import { LineItemsSection } from "./components/LineItemsSection";
import { SummaryCard } from "./components/SummaryCard";
import { CustomerInfoFooter } from "./components/CustomerInfoFooter";
import { VoidQuoteDialog } from "@/components/VoidQuoteDialog";
import { getPendingExpandedLineItemId, clearPendingExpandedLineItemId } from "@/lib/ui/persistExpandedLineItem";
import { getPendingScrollPosition, clearPendingScrollPosition } from "@/lib/ui/persistScrollPosition";
import type { CustomerSelectRef } from "@/components/CustomerSelect";

type QuoteEditorPageProps = {
    mode?: "view" | "edit";
};

export function QuoteEditorPage({ mode = "edit" }: QuoteEditorPageProps = {}) {
    // ALL HOOKS MUST BE CALLED UNCONDITIONALLY AT THE TOP
    const navigate = useNavigate();
    const location = useLocation();
    const { preferences } = useUserPreferences();
    const { toast } = useToast();
    const state = useQuoteEditorState();

    // Edit Mode is a UI state (not per-section) and controls whether inputs render at all.
    const [editMode, setEditMode] = useState(mode !== "view");
    const readOnly = !editMode;

    // Expanded line item (accordion) state
    // Stored as lineItemId (tempId || id) - persists across refetches
    // NOT derived from quote object identity, so it survives quote refetches
    const [expandedKey, setExpandedKey] = useState<string | null>(null);
    
    // Track whether we've already attempted restoration (one-shot)
    const didRestoreRef = useRef<boolean>(false);

    // Dialog state (convert is still a dialog for now; core editing stays inline)
    const [showConvertDialog, setShowConvertDialog] = useState(false);
    const [showUnsavedChangesDialog, setShowUnsavedChangesDialog] = useState(false);
    const [voidDialogOpen, setVoidDialogOpen] = useState(false);
    const [pendingNavigation, setPendingNavigation] = useState<(() => void) | null>(null);

    // Ref for customer select to enable initial focus
    const customerSelectRef = useRef<CustomerSelectRef>(null);
    // Track if we've already attempted focus for current route to prevent re-runs
    const hasAttemptedFocusRef = useRef<string | null>(null);

    // Ref to store pending transition retry callback for navigation blocking
    const pendingTransitionRef = useRef<(() => void) | null>(null);
    
    // Ref to prevent autosave when discard is in progress
    const discardInProgressRef = useRef<boolean>(false);

    // Access navigation context for BrowserRouter-compatible blocking
    const navigationContext = useContext(UNSAFE_NavigationContext);

    useEffect(() => {
        if (!editMode) setExpandedKey(null);
    }, [editMode]);

    // Preserve expanded state across refetches: ensure expandedKey still matches a line item
    // This prevents collapse when quote refetches after attachment upload
    // Only clear expandedKey if the line item was actually removed (not just refetched)
    useEffect(() => {
        if (!expandedKey) return;
        
        // Check if the expanded line item still exists in the current lineItems
        // Match by checking both tempId and id (handles tempId→id transitions during save)
        const stillExists = state.lineItems.some(li => {
            const itemKey = li.tempId || li.id || "";
            // Match if expandedKey equals the item's key, OR if expandedKey matches either tempId or id
            // This handles the case where expandedKey was set to tempId but item now only has id
            return itemKey === expandedKey || 
                   li.tempId === expandedKey || 
                   li.id === expandedKey;
        });
        
        // If the item no longer exists, clear expandedKey (item was removed)
        // Otherwise, keep it (item still exists, just refetched or transitioned tempId→id)
        if (!stillExists) {
            setExpandedKey(null);
        } else {
            // Update expandedKey to the current stable key (tempId || id) to handle tempId→id transitions
            const matchingItem = state.lineItems.find(li => {
                const itemKey = li.tempId || li.id || "";
                return itemKey === expandedKey || li.tempId === expandedKey || li.id === expandedKey;
            });
            if (matchingItem) {
                const currentKey = matchingItem.tempId || matchingItem.id || "";
                if (currentKey && currentKey !== expandedKey) {
                    setExpandedKey(currentKey);
                }
            }
        }
    }, [state.lineItems, expandedKey]);

    // Restore expansion state after route transition (e.g., when uploading artwork creates quote)
    // This provides seamless UX: line item stays expanded through /quotes/new → /quotes/:id navigation
    // TIMING CRITICAL: Only runs after quote data is fully loaded
    useEffect(() => {
        // Guard 1: One-shot restoration (prevent repeated attempts)
        if (didRestoreRef.current) return;
        
        // Guard 2: Only attempt restoration if we don't already have an expanded item
        if (expandedKey) return;
        
        // Guard 3: Must have a pending restoration
        const pending = getPendingExpandedLineItemId();
        if (!pending.key && pending.index === null) return;
        
        // Guard 4: Data must be loaded (wait for permanent quote with line items)
        // This prevents running during /quotes/new phase or before data arrives
        const dataLoaded = state.quoteId && // Have permanent quote ID
                          state.lineItems.length > 0 && // Have line items
                          !state.isInitialQuoteLoading; // Not in initial load
        
        if (!dataLoaded) return;
        
        // Try to find matching line item by key first
        let matchingItem = state.lineItems.find(li => {
            const itemKey = li.tempId || li.id || "";
            return itemKey === pending.key || li.tempId === pending.key || li.id === pending.key;
        });
        
        // Fallback: If key doesn't match (first-save transition), try index
        if (!matchingItem && pending.index !== null && pending.index >= 0 && pending.index < state.lineItems.length) {
            matchingItem = state.lineItems[pending.index];
        }
        
        if (matchingItem) {
            // Restore expansion to the current key (prefer tempId, fall back to id)
            const currentKey = matchingItem.tempId || matchingItem.id || "";
            if (currentKey) {
                setExpandedKey(currentKey);
            }
            // Mark restoration complete and clear storage
            didRestoreRef.current = true;
            clearPendingExpandedLineItemId();
        } else if (state.lineItems.length > 0) {
            // Data is loaded but target doesn't exist - restoration is invalid
            // Mark as attempted to prevent retries
            didRestoreRef.current = true;
            clearPendingExpandedLineItemId();
        }
        // If data not loaded yet, do nothing (will retry when deps change)
    }, [state.lineItems, state.quoteId, state.isInitialQuoteLoading, expandedKey]);

    // Restore scroll position after route transition
    // Runs AFTER data is loaded to ensure layout height exists
    useEffect(() => {
        const pendingScrollY = getPendingScrollPosition();
        if (pendingScrollY === null) return;
        
        // Data must be loaded before restoring scroll (same guard as expansion restore)
        const dataLoaded = state.quoteId && 
                          state.lineItems.length > 0 && 
                          !state.isInitialQuoteLoading;
        
        if (!dataLoaded) return;
        
        // Restore scroll position immediately (no smooth scroll - instant)
        // Use requestAnimationFrame to ensure DOM layout is complete
        requestAnimationFrame(() => {
            window.scrollTo(0, pendingScrollY);
            clearPendingScrollPosition();
        });
    }, [state.lineItems, state.quoteId, state.isInitialQuoteLoading]);


    // Block in-app navigation when there are unsaved changes (BrowserRouter-compatible)
    useEffect(() => {
        if (!navigationContext?.navigator) return;
        if (!state.hasUnsavedChanges) return;

        const { navigator } = navigationContext;
        
        // Type assertion for navigator.block() which exists but isn't in standard types
        const navigatorWithBlock = navigator as any;
        if (typeof navigatorWithBlock.block === 'function') {
            const unblock = navigatorWithBlock.block((tx: any) => {
                const nextPath = tx.location?.pathname || tx.location;
                const currentPath = location.pathname;

                // Only block if pathname changes
                if (nextPath !== currentPath) {
                    pendingTransitionRef.current = () => tx.retry();
                    setShowUnsavedChangesDialog(true);
                    // Don't call tx.retry() here - wait for user choice
                } else {
                    // Same path, allow navigation
                    tx.retry();
                }
            });

            return unblock;
        }
    }, [navigationContext, state.hasUnsavedChanges, location.pathname]);

    // Warn user before leaving page if there are unsaved changes (browser navigation)
    useEffect(() => {
        if (!state.hasUnsavedChanges) return;

        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
            e.preventDefault();
            e.returnValue = ""; // Modern browsers require this for the dialog to show
        };

        window.addEventListener("beforeunload", handleBeforeUnload);
        return () => window.removeEventListener("beforeunload", handleBeforeUnload);
    }, [state.hasUnsavedChanges]);

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
     * Centralized navigation decision after successful save.
     * Respects user preference for after-save navigation behavior.
     */
    const handlePostSaveNavigation = (result: { kind: "created" | "updated"; quoteId: string; quoteNumber?: string }) => {
        // For NEW quotes, always navigate to edit route with the new quoteId
        // (this is required for the quote to be properly loaded)
        if (result.kind === "created") {
            navigate(ROUTES.quotes.edit(result.quoteId), {
                replace: true,
                preventScrollReset: true,
                state: { quoteId: result.quoteId },
            });
            return;
        }

        // For EXISTING quotes, check user preference
        if (preferences.afterSaveNavigation === "back") {
            navigate(ROUTES.quotes.list);
        }
        // If preference is "stay", do nothing (stay on page)
    };

    /**
     * Wrapper for save quote - saves and navigates based on user preference
     */
    const handleSave = async () => {
        try {
            const result = await state.handlers.saveQuote();
            handlePostSaveNavigation(result);
        } catch (err) {
            // Error handling is already done inside saveQuote (toast shown)
            console.error("[QuoteEditorPage] Save failed", err);
        }
    };

    /**
     * Ensure quote exists and return its ID.
     * For new quotes, this saves the quote first.
     * For existing quotes, returns the current quoteId.
     * Used by artwork upload to ensure we have a quote to attach to.
     */
    const ensureQuoteId = async (): Promise<string> => {
        if (state.quoteId) {
            return state.quoteId;
        }

        // New quote - save it first
        const result = await state.handlers.saveQuote();
        
        // CRITICAL: Navigate to the newly created quote so the editor adopts it as canonical.
        // This prevents "Save Changes" from creating a duplicate quote and orphaning attachments.
        navigate(ROUTES.quotes.edit(result.quoteId), {
            replace: true,
            preventScrollReset: true,
            state: { quoteId: result.quoteId },
        });
        
        return result.quoteId;
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

    /**
     * Handle canceling/voiding a quote (for quotes with numbers)
     * Opens modal to collect reason, then updates status to 'canceled' to maintain audit trail
     */
    const handleCancelQuote = () => {
        if (!state.quoteId) return;
        setVoidDialogOpen(true);
    };

    /**
     * Confirm void quote with reason
     */
    const handleConfirmVoid = async (reason: string) => {
        if (!state.quoteId) return;
        
        try {
            // Update quote status to 'canceled'
            await apiRequest("PATCH", `/api/quotes/${state.quoteId}`, {
                status: "canceled",
            });
            
            toast({
                title: "Quote voided",
                description: `Quote has been marked as canceled. Reason: "${reason}" (Note: Reason not saved to database yet - no server support).`,
            });
            
            // Invalidate queries to refresh data
            await queryClient.invalidateQueries({ queryKey: ["/api/quotes", state.quoteId] });
            await queryClient.invalidateQueries({ queryKey: ["/api/quotes"] });
            
            // Navigate back to quotes list
            navigate(ROUTES.quotes.list, { replace: true });
        } catch (error) {
            console.error("[handleConfirmVoid] Error voiding quote:", error);
            toast({
                title: "Error voiding quote",
                description: error instanceof Error ? error.message : "Failed to void quote",
                variant: "destructive",
            });
            throw error; // Re-throw so dialog can handle it
        }
    };

    const handleDiscard = async () => {
        // Prevent any autosave during discard
        discardInProgressRef.current = true;
        
        try {
            // If quote exists (persisted), delete it from server
            if (state.quoteId) {
                const confirmed = window.confirm(
                    "Discard this draft quote? This will permanently remove the quote and all line items/attachments."
                );
                
                if (!confirmed) {
                    discardInProgressRef.current = false;
                    return;
                }
                
                // Call DELETE API
                await apiRequest("DELETE", `/api/quotes/${state.quoteId}`);
                
                toast({
                    title: "Draft discarded",
                    description: "Quote has been deleted.",
                });
            }
            
            // Reset local state (for both persisted and unpersisted quotes)
            await state.handlers.discardAllChanges();
            setExpandedKey(null);
            setEditMode(false);
            
            // Navigate back to quotes list
            navigate(ROUTES.quotes.list, { replace: true });
        } catch (error) {
            console.error("[handleDiscard] Error discarding quote:", error);
            toast({
                title: "Error discarding draft",
                description: error instanceof Error ? error.message : "Failed to discard quote",
                variant: "destructive",
            });
        } finally {
            discardInProgressRef.current = false;
        }
    };

    /**
     * Handle back navigation with unsaved changes check
     * Note: Navigation blocking via navigator.block() will handle most cases,
     * but we keep this for explicit Back button clicks
     */
    const handleBack = () => {
        if (state.hasUnsavedChanges) {
            // Set up pending navigation for the back button
            setPendingNavigation(() => () => navigate(ROUTES.quotes.list));
            setShowUnsavedChangesDialog(true);
        } else {
            navigate(ROUTES.quotes.list);
        }
    };

    /**
     * Handle "Save & Leave" from unsaved changes dialog
     */
    const handleSaveAndLeave = async () => {
        try {
            await state.handlers.saveQuote();
            setShowUnsavedChangesDialog(false);
            
            // Proceed with the pending transition if it exists
            if (pendingTransitionRef.current) {
                const retry = pendingTransitionRef.current;
                pendingTransitionRef.current = null;
                retry();
            } else if (pendingNavigation) {
                pendingNavigation();
                setPendingNavigation(null);
            } else {
                navigate(ROUTES.quotes.list);
            }
        } catch (err) {
            // Error is already shown via toast in saveQuote
            console.error("[QuoteEditorPage] Save & Leave failed", err);
            // Keep dialog open so user can try again or choose another option
        }
    };

    /**
     * Handle "Discard & Leave" from unsaved changes dialog
     */
    const handleDiscardAndLeave = () => {
        setShowUnsavedChangesDialog(false);
        
        // Proceed with the pending transition if it exists
        if (pendingTransitionRef.current) {
            const retry = pendingTransitionRef.current;
            pendingTransitionRef.current = null;
            retry();
        } else if (pendingNavigation) {
            pendingNavigation();
            setPendingNavigation(null);
        } else {
            navigate(ROUTES.quotes.list);
        }
    };

    /**
     * Handle "Cancel" from unsaved changes dialog
     */
    const handleCancelNavigation = () => {
        setShowUnsavedChangesDialog(false);
        // Clear both pending transition and explicit navigation
        pendingTransitionRef.current = null;
        setPendingNavigation(null);
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
                    onBack={handleBack}
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
                            customerId={state.selectedCustomerId}
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
                            onReorderLineItems={state.handlers.reorderLineItemsByKeys}
                            ensureQuoteId={ensureQuoteId}
                            ensureLineItemId={state.handlers.ensureLineItemId}
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

                        <div className="space-y-6">
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
                                selectedContactId={state.selectedContactId}
                                pricingStale={state.pricingStale}
                                canSaveQuote={state.canSaveQuote}
                                isSaving={state.isSaving}
                                hasUnsavedChanges={state.hasUnsavedChanges}
                                readOnly={readOnly}
                                onSave={handleSave}
                                onSaveAndBack={preferences.afterSaveNavigation === "back" ? undefined : handleSaveAndBack}
                                afterSaveNavigation={preferences.afterSaveNavigation}
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

                            <CustomerInfoFooter
                                selectedCustomer={state.selectedCustomer}
                                selectedContactId={state.selectedContactId}
                            />
                        </div>
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

            {/* Unsaved Changes Dialog - for both Back button and navigation blocking */}
            {showUnsavedChangesDialog && (
                <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
                    <Card className="max-w-md w-full">
                        <CardHeader>
                            <CardTitle>Unsaved Changes</CardTitle>
                            <CardDescription>
                                You have unsaved changes. What would you like to do?
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="flex flex-col gap-3">
                            <Button
                                onClick={handleSaveAndLeave}
                                disabled={state.isSaving}
                                className="w-full"
                            >
                                {state.isSaving ? "Saving..." : "Save & Leave"}
                            </Button>
                            <Button
                                variant="destructive"
                                onClick={handleDiscardAndLeave}
                                disabled={state.isSaving}
                                className="w-full"
                            >
                                Discard & Leave
                            </Button>
                            <Button
                                variant="outline"
                                onClick={handleCancelNavigation}
                                disabled={state.isSaving}
                                className="w-full"
                            >
                                Cancel
                            </Button>
                        </CardContent>
                    </Card>
                </div>
            )}

            {/* Void Quote Dialog */}
            <VoidQuoteDialog
                open={voidDialogOpen}
                onOpenChange={setVoidDialogOpen}
                quoteNumber={(state.quote as any)?.quoteNumber}
                onConfirm={handleConfirmVoid}
            />
        </div>
    );
}
