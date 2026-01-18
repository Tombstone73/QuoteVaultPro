import { useEffect, useMemo, useState, useRef, useContext } from "react";
import { useNavigate, useLocation, UNSAFE_NavigationContext } from "react-router-dom";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Lock, ExternalLink } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { ConvertQuoteToOrderDialog } from "@/components/convert-quote-to-order-dialog";
import { ROUTES } from "@/config/routes";
import { useUserPreferences } from "@/hooks/useUserPreferences";
import { useAuth } from "@/hooks/useAuth";
import { useOrgPreferences } from "@/hooks/useOrgPreferences";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useQuoteEditorState } from "./useQuoteEditorState";
import { QuoteHeader } from "./components/QuoteHeader";
import { CustomerCard, type CustomerCardRef } from "./components/CustomerCard";
import { LineItemsSection } from "./components/LineItemsSection";
import { SummaryCard } from "./components/SummaryCard";
import { VoidQuoteDialog } from "@/components/VoidQuoteDialog";
import { getPendingExpandedLineItemId, clearPendingExpandedLineItemId } from "@/lib/ui/persistExpandedLineItem";
import { getPendingScrollPosition, clearPendingScrollPosition } from "@/lib/ui/persistScrollPosition";
import { QuoteAttachmentsPanel } from "@/components/QuoteAttachmentsPanel";
import { TimelinePanel } from "@/components/TimelinePanel";
import { OrderFulfillmentPanel } from "@/components/orders/OrderFulfillmentPanel";
import type { CustomerSelectRef } from "@/components/CustomerSelect";
import { useQuoteWorkflowState } from "@/hooks/useQuoteWorkflowState";

type QuoteEditorPageProps = {
    mode?: "view" | "edit";
    createTarget?: "quote" | "order";
};

export function QuoteEditorPage({ mode = "edit", createTarget = "quote" }: QuoteEditorPageProps = {}) {
    // ALL HOOKS MUST BE CALLED UNCONDITIONALLY AT THE TOP
    const navigate = useNavigate();
    const location = useLocation();
    const { preferences } = useUserPreferences();
    const { user } = useAuth();
    const { preferences: orgPreferences } = useOrgPreferences();
    const { toast } = useToast();
    const state = useQuoteEditorState();

    const backPath = createTarget === "order" ? ROUTES.orders.list : ROUTES.quotes.list;

    // Get effective workflow state (includes derived states like converted)
    const workflowState = useQuoteWorkflowState(state.quote as any);
    const isLocked = workflowState === 'approved' || workflowState === 'converted';
    const lockedHint = workflowState === 'approved'
        ? 'Approved quotes are locked. Use Revise Quote to create a new draft.'
        : workflowState === 'converted'
        ? 'Converted quotes are locked. View the order for changes or use Revise Quote for a new draft.'
        : '';
    const convertedToOrderId = (state.quote as any)?.convertedToOrderId ?? null;
    const lockToastShownRef = useRef(false);
    
    // Revise quote mutation (creates new draft from approved/converted)
    const reviseMutation = useMutation({
        mutationFn: async (quoteId: string) => {
            const res = await fetch(`/api/quotes/${quoteId}/revise`, {
                method: "POST",
                credentials: "include",
            });
            if (!res.ok) {
                const error = await res.json().catch(() => ({ message: "Failed to revise quote" }));
                throw new Error(error.message || "Failed to revise quote");
            }
            return res.json() as Promise<{ id: string; quoteNumber: number }>;
        },
        onSuccess: (data, quoteId) => {
            // Invalidate old quote detail and list
            queryClient.invalidateQueries({ queryKey: ["/api/quotes", quoteId] });
            queryClient.invalidateQueries({ queryKey: ["/api/quotes"] });
            
            // Navigate to new draft quote
            navigate(`/quotes/${data.id}`);
            
            toast({
                title: "Quote Revised",
                description: `Created new draft quote #${data.quoteNumber}`,
            });
        },
        onError: (error: Error) => {
            toast({
                title: "Failed to revise quote",
                description: error.message,
                variant: "destructive",
            });
        },
    });
    
    const handleReviseQuote = () => {
        if (!state.quoteId) return;
        reviseMutation.mutate(state.quoteId);
    };

    // Approval workflow mutations
    const approveMutation = useMutation({
        mutationFn: async (quoteId: string) => {
            const res = await fetch(`/api/quotes/${quoteId}/transition`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ toState: "approved" }),
                credentials: "include",
            });
            if (!res.ok) {
                const error = await res.json();
                throw new Error(error.error || error.message || "Failed to approve quote");
            }
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["/api/quotes"] });
            queryClient.invalidateQueries({ queryKey: ["/api/quotes", state.quoteId] });
            queryClient.invalidateQueries({ queryKey: ["/api/timeline"] });
            queryClient.invalidateQueries({ queryKey: ["/api/quotes/pending-approvals"] });
            toast({ title: "Quote Approved", description: "Quote has been approved and locked" });
        },
        onError: (error: Error) => {
            toast({ title: "Approval Failed", description: error.message, variant: "destructive" });
        },
    });

    const approveAndSendMutation = useMutation({
        mutationFn: async (quoteId: string) => {
            // Step 1: Approve
            const approveRes = await fetch(`/api/quotes/${quoteId}/transition`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ toState: "approved" }),
                credentials: "include",
            });
            if (!approveRes.ok) {
                const error = await approveRes.json();
                throw new Error(error.error || error.message || "Failed to approve quote");
            }

            // Step 2: Send
            const sendRes = await fetch(`/api/quotes/${quoteId}/transition`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ toState: "sent" }),
                credentials: "include",
            });
            if (!sendRes.ok) {
                const error = await sendRes.json();
                throw new Error(error.error || error.message || "Failed to send quote");
            }

            return sendRes.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["/api/quotes"] });
            queryClient.invalidateQueries({ queryKey: ["/api/quotes", state.quoteId] });
            queryClient.invalidateQueries({ queryKey: ["/api/timeline"] });
            queryClient.invalidateQueries({ queryKey: ["/api/quotes/pending-approvals"] });
            toast({ title: "Quote Approved & Sent", description: "Quote has been approved and marked as sent" });
        },
        onError: (error: Error) => {
            toast({ title: "Approve & Send Failed", description: error.message, variant: "destructive" });
        },
    });

    const requestApprovalMutation = useMutation({
        mutationFn: async (quoteId: string) => {
            const res = await fetch(`/api/quotes/${quoteId}/transition`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ toState: "pending_approval" }),
                credentials: "include",
            });
            if (!res.ok) {
                const error = await res.json();
                throw new Error(error.error || error.message || "Failed to request approval");
            }
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["/api/quotes"] });
            queryClient.invalidateQueries({ queryKey: ["/api/quotes", state.quoteId] });
            queryClient.invalidateQueries({ queryKey: ["/api/timeline"] });
            queryClient.invalidateQueries({ queryKey: ["/api/quotes/pending-approvals"] });
            toast({ title: "Approval Requested", description: "Quote submitted for approval" });
        },
        onError: (error: Error) => {
            toast({ title: "Request Failed", description: error.message, variant: "destructive" });
        },
    });

    const handleApprove = () => {
        if (!state.quoteId) return;
        approveMutation.mutate(state.quoteId);
    };

    const handleApproveAndSend = () => {
        if (!state.quoteId) return;
        approveAndSendMutation.mutate(state.quoteId);
    };

    const handleRequestApproval = () => {
        if (!state.quoteId) return;
        requestApprovalMutation.mutate(state.quoteId);
    };

    // Quote update mutation for shipTo fields (like orders)
    const updateQuote = useMutation({
        mutationFn: async (updates: Record<string, any>) => {
            if (!state.quoteId) throw new Error("No quote ID");
            const res = await fetch(`/api/quotes/${state.quoteId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(updates),
                credentials: "include",
            });
            if (!res.ok) {
                const error = await res.json().catch(() => ({ message: "Failed to update quote" }));
                throw new Error(error.message || "Failed to update quote");
            }
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["/api/quotes", state.quoteId] });
        },
        onError: (error: Error) => {
            toast({
                title: "Update Failed",
                description: error.message,
                variant: "destructive",
            });
        },
    });

    // Save shipTo fields (similar to orders)
    const saveShipTo = async (payload: Record<string, any>) => {
        try {
            // Map ShipToData field names to quote field names
            const mappedPayload: Record<string, any> = {};
            if (payload.company !== undefined) mappedPayload.shipToCompany = payload.company;
            if (payload.name !== undefined) mappedPayload.shipToName = payload.name;
            if (payload.email !== undefined) mappedPayload.shipToEmail = payload.email;
            if (payload.phone !== undefined) mappedPayload.shipToPhone = payload.phone;
            if (payload.address1 !== undefined) mappedPayload.shipToAddress1 = payload.address1;
            if (payload.address2 !== undefined) mappedPayload.shipToAddress2 = payload.address2;
            if (payload.city !== undefined) mappedPayload.shipToCity = payload.city;
            if (payload.state !== undefined) mappedPayload.shipToState = payload.state;
            if (payload.postalCode !== undefined) mappedPayload.shipToPostalCode = payload.postalCode;
            if (payload.country !== undefined) mappedPayload.shipToCountry = payload.country;
            
            await updateQuote.mutateAsync(mappedPayload);
        } catch (error) {
            // Error toast handled by mutation
        }
    };

    // Save shipping cost
    const saveShippingCents = async (cents: number | null) => {
        try {
            // Update local state immediately so Save Changes has the latest value
            state.handlers.setShippingCents(cents);
            await updateQuote.mutateAsync({ shippingCents: cents });
        } catch (error) {
            // Error toast handled by mutation
        }
    };

    // Save fulfillment method
    const saveFulfillmentMethod = async (method: "pickup" | "ship" | "deliver") => {
        try {
            // Update local state immediately for UI responsiveness
            state.handlers.setDeliveryMethod(method);
            // Persist to server
            await updateQuote.mutateAsync({ shippingMethod: method });
        } catch (error) {
            // Error toast handled by mutation
        }
    };

    // Edit Mode is a UI state (not per-section) and controls whether inputs render at all.
    const [editMode, setEditMode] = useState(mode !== "view");
    const readOnly = !editMode || isLocked;

    // Enforce enterprise locking: approved/converted quotes are view-only
    useEffect(() => {
        if (!isLocked) return;

        if (editMode) {
            setEditMode(false);
        }

        if (!lockToastShownRef.current) {
            lockToastShownRef.current = true;
            toast({ title: 'Locked', description: lockedHint, variant: 'destructive' });
        }
    }, [isLocked, editMode, toast, lockedHint]);

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
    const [timelineOpen, setTimelineOpen] = useState(false);

    // Ref for customer select to enable initial focus
    const customerSelectRef = useRef<(CustomerSelectRef & CustomerCardRef) | null>(null);
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
            // Special case: /orders/new uses the quote editor UI but immediately converts
            // the created quote into an order and navigates to the order detail.
            if (createTarget === "order") {
                // Fire-and-forget-ish: convert hook handles toast + navigation.
                void (async () => {
                    try {
                        await state.convertToOrderHook?.mutateAsync({ quoteId: result.quoteId });
                    } catch (err) {
                        // Fall back to the quote editor (with id) so the user doesn't lose work.
                        navigate(ROUTES.quotes.edit(result.quoteId), {
                            replace: true,
                            preventScrollReset: true,
                            state: { quoteId: result.quoteId },
                        });
                    }
                })();
                return;
            }

            navigate(ROUTES.quotes.edit(result.quoteId), {
                replace: true,
                preventScrollReset: true,
                state: { quoteId: result.quoteId },
            });
            return;
        }

        // For EXISTING quotes, check user preference
        if (preferences.afterSaveNavigation === "back") {
            navigate(backPath);
        }
        // If preference is "stay", do nothing (stay on page)
    };

    /**
     * Wrapper for save quote - saves and navigates based on user preference
     */
    const handleSave = async () => {
        try {
            // Commit any pending flags before saving
            customerSelectRef.current?.commitPendingFlags?.();
            
            const result = await state.handlers.saveQuote();
            handlePostSaveNavigation(result);
        } catch (err) {
            // Error handling is already done inside saveQuote (toast shown)
            console.error("[QuoteEditorPage] Save failed", err);
        }
    };

    /**
     * /orders/new primary action.
     * Creates/updates the underlying quote, then converts it into an order.
     */
    const handleCreateOrder = async () => {
        try {
            customerSelectRef.current?.commitPendingFlags?.();

            const result = await state.handlers.saveQuote();
            await state.convertToOrderHook?.mutateAsync({ quoteId: result.quoteId });
        } catch (err) {
            // saveQuote / convertToOrder both toast already; just fail-soft.
            console.error("[QuoteEditorPage] Create Order failed", err);
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

        // In the standard quote flow, we navigate to the newly created quote so the editor adopts
        // it as canonical. In the /orders/new flow, we intentionally avoid route changes.
        if (createTarget !== "order") {
            // CRITICAL: Navigate to the newly created quote so the editor adopts it as canonical.
            // This prevents "Save Changes" from creating a duplicate quote and orphaning attachments.
            navigate(ROUTES.quotes.edit(result.quoteId), {
                replace: true,
                preventScrollReset: true,
                state: { quoteId: result.quoteId },
            });
        }
        
        return result.quoteId;
    };

    /**
     * Save quote and navigate back to quotes list
     */
    const handleSaveAndBack = async () => {
        try {
            // Commit any pending flags before saving
            customerSelectRef.current?.commitPendingFlags?.();
            
            await state.handlers.saveQuote();
            navigate(backPath, { replace: true });
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
            navigate(backPath, { replace: true });
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
            navigate(backPath, { replace: true });
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
            setPendingNavigation(() => () => navigate(backPath));
            setShowUnsavedChangesDialog(true);
        } else {
            navigate(backPath);
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
                navigate(backPath);
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
            navigate(backPath);
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
            <div className="mx-auto w-full max-w-[1600px] px-6 py-4">
                {/* Top bar: Back + Quote # + Status + Actions */}
                <QuoteHeader
                    quoteNumber={(state.quote as any)?.quoteNumber || ""}
                    quoteId={state.quoteId}
                    newTitle={createTarget === "order" ? "New Order" : undefined}
                    canDuplicateQuote={state.canDuplicateQuote}
                    isDuplicatingQuote={state.isDuplicatingQuote}
                    status={(state.quote as any)?.status}
                    effectiveWorkflowState={workflowState}
                    showReviseButton={isLocked}
                    isRevisingQuote={reviseMutation.isPending}
                    editMode={editMode}
                    editModeDisabled={state.isSaving || isLocked}
                    onBack={handleBack}
                    onDuplicateQuote={state.handlers.duplicateQuote}
                    onReviseQuote={handleReviseQuote}
                    onEditModeChange={(next) => {
                        if (isLocked) {
                            toast({ title: 'Locked', description: lockedHint, variant: 'destructive' });
                            setEditMode(false);
                            return;
                        }
                        setEditMode(next);
                    }}
                />

                {isLocked && lockedHint && (
                    <Alert className="mt-4 border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950">
                        <Lock className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                        <AlertDescription className="flex items-center justify-between text-amber-900 dark:text-amber-100">
                            <span>{lockedHint}</span>
                            {workflowState === 'converted' && convertedToOrderId && (
                                <Button
                                    variant="link"
                                    size="sm"
                                    className="text-amber-900 dark:text-amber-100 underline"
                                    onClick={() => navigate(`/orders/${convertedToOrderId}`)}
                                >
                                    View Order <ExternalLink className="ml-1 h-3 w-3" />
                                </Button>
                            )}
                        </AlertDescription>
                    </Alert>
                )}

                {/* Two-column layout: Left (Customer + Line Items + Totals) | Right (Fulfillment + Attachments) */}
                <div className="grid gap-6 mt-6 lg:grid-cols-[1fr_400px]">
                    {/* LEFT COLUMN: Customer + Line Items + Totals */}
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

                        {/* Quote Summary / Totals - Moved to left column */}
                        <SummaryCard
                            lineItems={state.lineItems}
                            products={state.products}
                            subtotal={state.subtotal}
                            taxAmount={state.taxAmount}
                            grandTotal={state.grandTotal}
                            effectiveTaxRate={state.effectiveTaxRate}
                            discountAmount={state.discountAmount}
                            shippingCents={state.shippingCents}
                            deliveryMethod={state.deliveryMethod}
                            selectedCustomer={state.selectedCustomer}
                            selectedContactId={state.selectedContactId}
                            pricingStale={state.pricingStale}
                            canSaveQuote={state.canSaveQuote}
                            isSaving={createTarget === "order" ? (state.isSaving || !!state.convertToOrderHook?.isPending) : state.isSaving}
                            hasUnsavedChanges={state.hasUnsavedChanges}
                            readOnly={readOnly}
                            onSave={createTarget === "order" ? handleCreateOrder : handleSave}
                            onSaveAndBack={createTarget === "order" ? undefined : (preferences.afterSaveNavigation === "back" ? undefined : handleSaveAndBack)}
                            afterSaveNavigation={preferences.afterSaveNavigation}
                            primaryActionLabel={createTarget === "order" ? "Create Order" : undefined}
                            primaryActionSavingLabel={createTarget === "order" ? "Creating Order…" : undefined}
                            onConvertToOrder={createTarget === "order" ? (() => {}) : (() => setShowConvertDialog(true))}
                            canConvertToOrder={state.canConvertToOrder}
                            convertToOrderPending={state.convertToOrderHook?.isPending}
                            showConvertToOrder={createTarget === "order" ? false : (!editMode && !!state.quoteId)}
                            onDiscard={handleDiscard}
                            onDiscountAmountChange={state.handlers.setDiscountAmount}
                            quoteTaxExempt={state.quoteTaxExempt}
                            quoteTaxRateOverride={state.quoteTaxRateOverride}
                            onQuoteTaxExemptChange={state.handlers.setQuoteTaxExempt}
                            onQuoteTaxRateOverrideChange={state.handlers.setQuoteTaxRateOverride}
                            workflowState={workflowState || undefined}
                            requireApproval={orgPreferences?.quotes?.requireApproval || false}
                            isInternalUser={user ? ['owner', 'admin', 'manager', 'employee'].includes((user.role || '').toLowerCase()) : false}
                            onApprove={handleApprove}
                            onApproveAndSend={handleApproveAndSend}
                            onRequestApproval={handleRequestApproval}
                            isApproving={approveMutation.isPending}
                            isApprovingAndSending={approveAndSendMutation.isPending}
                            isRequestingApproval={requestApprovalMutation.isPending}
                        />
                    </div>

                    {/* RIGHT COLUMN: Fulfillment + Attachments + Info */}
                    <div className="space-y-6 lg:sticky lg:top-4 h-fit">
                        {/* Fulfillment & Shipping Panel - Reuses Orders component */}
                        <OrderFulfillmentPanel
                            mode="quote"
                            parentType="quote"
                            fulfillmentMethod={state.deliveryMethod as 'pickup' | 'ship' | 'deliver'}
                            shipToData={{
                                // Use persisted quote shipTo fields from DB
                                company: (state.quote as any)?.shipToCompany,
                                name: (state.quote as any)?.shipToName,
                                email: (state.quote as any)?.shipToEmail,
                                phone: (state.quote as any)?.shipToPhone,
                                address1: (state.quote as any)?.shipToAddress1,
                                address2: (state.quote as any)?.shipToAddress2,
                                city: (state.quote as any)?.shipToCity,
                                state: (state.quote as any)?.shipToState,
                                postalCode: (state.quote as any)?.shipToPostalCode,
                                country: (state.quote as any)?.shipToCountry,
                            }}
                            shippingInstructions={state.quoteNotes}
                            shippingCents={state.shippingCents}
                            canEditOrder={!readOnly}
                            isEditingFulfillment={!readOnly}
                            onFulfillmentMethodChange={!readOnly ? saveFulfillmentMethod : undefined}
                            onShippingInstructionsChange={!readOnly ? ((instructions: string | null) => state.handlers.setQuoteNotes(instructions ?? '')) : undefined}
                            onShipToChange={!readOnly ? saveShipTo : undefined}
                            onShippingCentsChange={!readOnly ? saveShippingCents : undefined}
                        />

                        {/* Attachments - Now more prominent in right column */}
                        {!!state.quoteId && (
                            <Card>
                                <CardHeader className="pb-3">
                                    <CardTitle className="text-base font-medium">Attachments</CardTitle>
                                    <CardDescription>Add POs, instructions, artwork files, etc.</CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <QuoteAttachmentsPanel quoteId={state.quoteId} locked={isLocked} />
                                </CardContent>
                            </Card>
                        )}

                        {/* Internal Notes (uses existing quote shippingInstructions / editor quoteNotes field) */}
                        <Card>
                            <CardHeader className="pb-3">
                                <CardTitle className="text-base font-medium">Internal Notes</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <Textarea
                                    placeholder="Visible to internal staff only"
                                    value={state.quoteNotes}
                                    onChange={(e) => state.handlers.setQuoteNotes(e.target.value)}
                                    readOnly={readOnly}
                                    rows={5}
                                    className="w-full"
                                />
                                {!readOnly && state.quoteNotes.trim().length === 0 && (
                                    <div className="mt-2 text-xs text-muted-foreground">
                                        Add internal production notes before converting (optional)
                                    </div>
                                )}
                            </CardContent>
                        </Card>

                        {/* Timeline */}
                        <Card className="rounded-lg border border-border/40 bg-card/30">
                            <CardContent className="p-4">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="text-[11px] font-medium text-muted-foreground">Timeline</div>
                                    <button
                                        type="button"
                                        onClick={() => setTimelineOpen(v => !v)}
                                        className="shrink-0 text-[11px] text-muted-foreground hover:text-foreground underline underline-offset-4"
                                    >
                                        {timelineOpen ? "Hide" : "Show"}
                                    </button>
                                </div>

                                {timelineOpen ? (
                                    <div className="mt-3">
                                        <TimelinePanel
                                            quoteId={state.quoteId ?? undefined}
                                            orderId={convertedToOrderId ?? undefined}
                                            limit={100}
                                        />
                                    </div>
                                ) : null}
                            </CardContent>
                        </Card>
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
