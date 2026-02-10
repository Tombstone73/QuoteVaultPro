import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { useConvertQuoteToOrder } from "@/hooks/useOrders";
import { ROUTES } from "@/config/routes";
import type { CustomerWithContacts } from "@/components/CustomerSelect";
import type { Product, ProductVariant, QuoteWithRelations, ProductOptionItem, Organization } from "@shared/schema";
import type { LineItemOptionSelectionsV2 } from "@shared/optionTreeV2";
import { injectDerivedMaterialOptionIntoProductOptions } from "@shared/productOptionUi";
import type { QuoteLineItemDraft, Address, OptionSelection } from "./types";

type QuoteEditorRouteParams = {
    id?: string;
    quoteId?: string;
};

/**
 * Result type for saveQuote operation
 */
export type SaveQuoteResult =
    | { kind: "created"; quoteId: string; quoteNumber?: string }
    | { kind: "updated"; quoteId: string; quoteNumber?: string };

/**
 * Helper: Get stable key for line item (TEMP-FIRST for consistency across TEMP → PERMANENT transitions)
 */
function getStableLineItemKey(li: QuoteLineItemDraft): string {
    return li.tempId || li.id || "";
}

/**
 * Main hook for Quote Editor state management and business logic.
 * Centralizes all data fetching, state, and handlers for the quote editor.
 */
export function useQuoteEditorState() {
    const { toast } = useToast();
    const { user } = useAuth();
    const params = useParams<QuoteEditorRouteParams>();
    const navigate = useNavigate();
    const location = useLocation();
    const queryClientInstance = useQueryClient();

    // ============================================================================
    // ROUTE PARAMS & FLAGS
    // ============================================================================

    // Accept either /quotes/:id or /quotes/:quoteId
    const routeQuoteId = params.quoteId ?? params.id ?? null;

    // Are we on the "new quote" route?
    const isNewQuoteRoute = location.pathname === ROUTES.quotes.new;

    // Track imperatively created quotes (e.g., via ensureQuoteId during artwork upload)
    // This ensures the editor adopts the quote even before route navigation completes.
    const [imperativeQuoteId, setImperativeQuoteId] = useState<string | null>(null);
    
    // Clear imperative quoteId when route changes to an actual quote (navigation completed)
    useEffect(() => {
        if (!isNewQuoteRoute && routeQuoteId) {
            setImperativeQuoteId(null);
        }
    }, [isNewQuoteRoute, routeQuoteId]);
    
    // Canonical quoteId: prefer imperatively created > route param > null
    const quoteId: string | null = imperativeQuoteId ?? (isNewQuoteRoute ? null : routeQuoteId);
    const isNewQuote = !quoteId;

    const isInternalUser = user && ['admin', 'owner', 'manager', 'employee'].includes(user.role || '');

    // ============================================================================
    // CUSTOMER STATE
    // ============================================================================

    const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
    const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
    const [selectedCustomer, setSelectedCustomer] = useState<CustomerWithContacts | undefined>(undefined);

    // ============================================================================
    // QUOTE META (label / due date / discount)
    // ============================================================================

    const [jobLabel, setJobLabel] = useState<string>("");
    // Store as ISO date string (YYYY-MM-DD) for simple input compatibility.
    const [requestedDueDate, setRequestedDueDate] = useState<string>("");
    // Stored as absolute currency amount (not %).
    const [discountAmount, setDiscountAmount] = useState<number>(0);
    // Tags for quote/order (client-side only for now - backend doesn't support yet)
    const [tags, setTags] = useState<string[]>([]);
    // Quote-level tax override (overrides customer tax settings)
    const [quoteTaxExempt, setQuoteTaxExempt] = useState<boolean | null>(null);
    const [quoteTaxRateOverride, setQuoteTaxRateOverride] = useState<number | null>(null);

    // ============================================================================
    // FULFILLMENT STATE
    // ============================================================================

    const [deliveryMethod, setDeliveryMethod] = useState<'pickup' | 'ship' | 'deliver'>('pickup');
    const [shippingCents, setShippingCents] = useState<number | null>(null);
    const [useCustomerAddress, setUseCustomerAddress] = useState(false);
    const [shippingAddress, setShippingAddress] = useState<Address>({
        street1: '',
        street2: '',
        city: '',
        state: '',
        postalCode: '',
        country: 'USA'
    });
    const [quoteNotes, setQuoteNotes] = useState('');

    // ============================================================================
    // PRODUCT SEARCH STATE
    // ============================================================================

    const [productSearchOpen, setProductSearchOpen] = useState(false);
    const [productSearchQuery, setProductSearchQuery] = useState("");

    // ============================================================================
    // LINE ITEMS STATE
    // ============================================================================

    const [lineItems, setLineItems] = useState<QuoteLineItemDraft[]>([]);
    const [draftLineItemId, setDraftLineItemId] = useState<string | null>(null);
    const [isCreatingDraft, setIsCreatingDraft] = useState(false);
    const [isDuplicatingQuote, setIsDuplicatingQuote] = useState(false);

    // Snapshot of last-saved state to support full discard.
    const savedSnapshotRef = useRef<{
        selectedCustomerId: string | null;
        selectedContactId: string | null;
        selectedCustomer: CustomerWithContacts | undefined;
        deliveryMethod: 'pickup' | 'ship' | 'deliver';
        shippingCents: number | null;
        useCustomerAddress: boolean;
        shippingAddress: Address;
        quoteNotes: string;
        jobLabel: string;
        requestedDueDate: string;
        discountAmount: number;
        tags: string[];
        quoteTaxExempt: boolean | null;
        quoteTaxRateOverride: number | null;
        lineItems: QuoteLineItemDraft[];
    } | null>(null);

    // Track which quote we've hydrated tags from (prevent stomping on edits)
    const hydratedTagsForQuoteIdRef = useRef<string | null>(null);

    // Track which quote we've fully hydrated (prevent re-hydration on refetch)
    const hydratedQuoteIdRef = useRef<string | null>(null);

    // Track if there are unsaved changes
    const hasUnsavedChanges = useMemo(() => {
        const snap = savedSnapshotRef.current;
        if (!snap) return false; // No snapshot means new quote or not loaded yet
        
        // Compare current state with saved snapshot
        if (selectedCustomerId !== snap.selectedCustomerId) return true;
        if (selectedContactId !== snap.selectedContactId) return true;
        if (jobLabel !== snap.jobLabel) return true;
        if (requestedDueDate !== snap.requestedDueDate) return true;
        if (Math.abs(discountAmount - snap.discountAmount) > 0.01) return true;
        if (deliveryMethod !== snap.deliveryMethod) return true;
        if ((shippingCents ?? null) !== snap.shippingCents) return true;
        if (quoteNotes !== snap.quoteNotes) return true;
        if (JSON.stringify(tags) !== JSON.stringify(snap.tags)) return true;
        if (quoteTaxExempt !== snap.quoteTaxExempt) return true;
        if (quoteTaxRateOverride !== snap.quoteTaxRateOverride) return true;
        
        // Compare line items (using stable TEMP-FIRST keys)
        const currentIds = new Set(lineItems.map(li => getStableLineItemKey(li)).filter((id): id is string => !!id));
        const savedIds = new Set(snap.lineItems.map(li => getStableLineItemKey(li)).filter((id): id is string => !!id));
        if (currentIds.size !== savedIds.size) return true;
        const currentIdsArray = Array.from(currentIds);
        for (const id of currentIdsArray) {
            if (!savedIds.has(id)) return true;
            const current = lineItems.find(li => getStableLineItemKey(li) === id);
            const saved = snap.lineItems.find(li => getStableLineItemKey(li) === id);
            if (!current || !saved) return true;
            if (current.linePrice !== saved.linePrice) return true;
            if (current.width !== saved.width) return true;
            if (current.height !== saved.height) return true;
            if (current.quantity !== saved.quantity) return true;
            if (JSON.stringify(current.selectedOptions) !== JSON.stringify(saved.selectedOptions)) return true;
        }
        
        return false;
    }, [
        selectedCustomerId,
        selectedContactId,
        jobLabel,
        requestedDueDate,
        discountAmount,
        deliveryMethod,
        quoteNotes,
        tags,
        quoteTaxExempt,
        quoteTaxRateOverride,
        lineItems,
    ]);

    // ============================================================================
    // PRODUCT BUILDER STATE
    // ============================================================================

    const [selectedProductId, setSelectedProductId] = useState("");
    const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);
    const [width, setWidth] = useState("");
    const [height, setHeight] = useState("");
    const [quantity, setQuantity] = useState("1");
    const [calculatedPrice, setCalculatedPrice] = useState<number | null>(null);
    const [isCalculating, setIsCalculating] = useState(false);
    const [calcError, setCalcError] = useState<string | null>(null);
    const [pricingStale, setPricingStale] = useState(false);
    const [isRepricingLineItems, setIsRepricingLineItems] = useState(false);
    const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
    const abortControllerRef = useRef<AbortController | null>(null);
    const calcRequestIdRef = useRef(0);
    const lastCalcInputsHashRef = useRef<string | null>(null);
    const repricingRequestIdRef = useRef(0);

    // ============================================================================
    // OPTION SELECTION STATE
    // ============================================================================

    const [optionSelections, setOptionSelections] = useState<Record<string, OptionSelection>>({});
    const [optionSelectionsJson, setOptionSelectionsJson] = useState<LineItemOptionSelectionsV2>({ schemaVersion: 2, selected: {} });
    const [lineItemNotes, setLineItemNotes] = useState<string>("");

    // ============================================================================
    // DATA FETCHING: Products
    // ============================================================================

    const { data: products } = useQuery<Product[]>({
        queryKey: ["/api/products"],
    });

    // ============================================================================
    // DATA FETCHING: Organization
    // ============================================================================

    const { data: organization } = useQuery<Organization>({
        queryKey: ["/api/organization/current"],
        queryFn: async () => {
            const response = await fetch("/api/organization/current", { credentials: "include" });
            if (!response.ok) throw new Error("Failed to fetch organization");
            return response.json();
        },
    });

    // ============================================================================
    // DATA FETCHING: Quote (existing quote only)
    // ============================================================================

    const {
        data: quote,
        isLoading: quoteLoading,
        isFetching: quoteFetching,
        error: quoteError,
    } = useQuery<QuoteWithRelations, Error>({
        queryKey: ["/api/quotes", quoteId],
        queryFn: async () => {
            if (!quoteId) throw new Error("Quote ID is required");
            const response = await fetch(`/api/quotes/${quoteId}`, { credentials: "include" });
            if (!response.ok) throw new Error("Failed to load quote");
            return response.json();
        },
        enabled: !!quoteId,
        staleTime: 60_000,
        placeholderData: (prev: any) => prev,
        retry: false,
        // @ts-expect-error onError is supported at runtime but not in this type version
        onError: (err: Error) => {
            console.error("[QuoteEditor] failed to load quote", { quoteId, err });
        },
    });

    const hasQuote = !!quote;
    const isInitialQuoteLoading = !!quoteId && quoteLoading && !hasQuote;
    const isQuoteRefreshing = !!quoteId && quoteFetching && hasQuote;

    console.log("[useQuoteEditorState] state", {
        quoteId,
        quoteLoading,
        quoteFetching,
        hasQuote,
        isInitialQuoteLoading,
        isQuoteRefreshing,
        hasError: !!quoteError,
    });

    // ============================================================================
    // DATA FETCHING: Customer Details
    // ============================================================================

    const { data: customerData } = useQuery<CustomerWithContacts>({
        queryKey: ["/api/customers", selectedCustomerId],
        queryFn: async () => {
            if (!selectedCustomerId) throw new Error("No customer ID");
            const response = await fetch(`/api/customers/${selectedCustomerId}`, { credentials: "include" });
            if (!response.ok) throw new Error("Failed to fetch customer");
            return response.json();
        },
        enabled: !!selectedCustomerId && !selectedCustomer,
    });

    // ============================================================================
    // DATA FETCHING: Product Variants
    // ============================================================================

    const { data: productVariants } = useQuery<ProductVariant[]>({
        queryKey: ["/api/products", selectedProductId, "variants"],
        enabled: !!selectedProductId,
    });

    // ============================================================================
    // COMPUTED VALUES: Selected Product
    // ============================================================================

    const selectedProduct = useMemo(() =>
        products?.find((p) => p.id === selectedProductId) ?? null,
        [products, selectedProductId]
    );

    const requiresDimensions = useMemo(() => {
        if (!selectedProduct) return false;

        const anyProduct = selectedProduct as any;

        // If the backend ever adds a real boolean, honor it.
        if (typeof anyProduct.requiresDimensions === "boolean") {
            return anyProduct.requiresDimensions;
        }

        // Fee/addon products don't need dimensions
        if (anyProduct.pricingMode === "fee" || anyProduct.pricingMode === "addon") {
            return false;
        }

        // Area-based pricing requires dimensions
        if (anyProduct.pricingMode === "area") {
            return true;
        }

        // For other modes (unit, perQty, etc.), dimensions not required
        return false;
    }, [selectedProduct]);

    const productOptions = useMemo(() => {
        const base = (selectedProduct?.optionsJson as ProductOptionItem[] | undefined) || [];
        return injectDerivedMaterialOptionIntoProductOptions(selectedProduct, base);
    }, [selectedProduct]);

    const hasAttachmentOption = useMemo(
        () => productOptions.some((opt) => (opt as any).type === "attachment"),
        [productOptions]
    );

    // ============================================================================
    // COMPUTED VALUES: Filtered Products
    // ============================================================================

    const filteredProducts = useMemo(() => {
        if (!products) return [];
        const activeProducts = products.filter(p => p.isActive);
        
        // Apply search filter if query exists
        let result = activeProducts;
        if (productSearchQuery.trim()) {
            const query = productSearchQuery.toLowerCase();
            result = activeProducts.filter(p =>
                p.name.toLowerCase().includes(query) ||
                ((p as any).sku && String((p as any).sku).toLowerCase().includes(query)) ||
                ((p as any).category && String((p as any).category).toLowerCase().includes(query))
            );
        }
        
        // Sort alphabetically by product name (case-insensitive, stable sort)
        return [...result].sort((a, b) => {
            const nameA = (a.name || "").trim().toLowerCase();
            const nameB = (b.name || "").trim().toLowerCase();
            return nameA.localeCompare(nameB, undefined, { sensitivity: 'base' });
        });
    }, [products, productSearchQuery]);

    // ============================================================================
    // COMPUTED VALUES: Contacts
    // ============================================================================

    const contacts = selectedCustomer?.contacts || [];

    // ============================================================================
    // COMPUTED VALUES: Pricing (reactive - updates when lineItems change)
    // ============================================================================

    const activeLineItems = useMemo(
        () => lineItems.filter((li) => li.status !== "draft" && li.status !== "canceled"),
        [lineItems]
    );

    const effectiveTaxRate = useMemo(() => {
        // Quote-level overrides take precedence
        if (quoteTaxExempt === true) {
            return 0;
        }
        if (quoteTaxRateOverride != null) {
            return Number(quoteTaxRateOverride);
        }
        // Fall back to customer settings
        return selectedCustomer?.isTaxExempt
            ? 0
            : selectedCustomer?.taxRateOverride != null
                ? Number(selectedCustomer.taxRateOverride)
                : Number(organization?.defaultTaxRate || 0);
    }, [quoteTaxExempt, quoteTaxRateOverride, selectedCustomer, organization]);

    const effectiveDiscount = useMemo(
        () => (Number.isFinite(discountAmount) ? Math.max(0, discountAmount) : 0),
        [discountAmount]
    );

    // Single source of truth: computedTotals derived from current editor state
    const computedTotals = useMemo(() => {
        // Subtotal = sum of current lineItems' linePrice (or lineTotal if used)
        const subtotal = activeLineItems.reduce((sum, item) => {
            const lineTotal = item.linePrice ?? 0;
            return sum + (Number.isFinite(lineTotal) ? lineTotal : 0);
        }, 0);

        // Discount = current discount in state
        const discount = effectiveDiscount;

        // Tax = computed from taxable subtotal * current taxRate (respect tax exempt)
        const taxableBase = Math.max(0, subtotal - discount);
        const tax = taxableBase * effectiveTaxRate;

        // Grand Total = subtotal - discount + tax + shipping + fees
        const shippingAmount = (shippingCents ?? 0) / 100;
        const fees = 0; // Fees not currently in state; keep as 0
        const grandTotal = taxableBase + tax + shippingAmount + fees;

        return {
            subtotal,
            discount,
            tax,
            grandTotal,
        };
    }, [activeLineItems, effectiveDiscount, effectiveTaxRate, shippingCents]);

    // Extract individual values for backward compatibility
    const subtotal = computedTotals.subtotal;
    const taxAmount = computedTotals.tax;
    const grandTotal = computedTotals.grandTotal;

    // Dev-only sanity check: log totals changes (guarded for production builds)
    useEffect(() => {
        if (process.env.NODE_ENV === "development") {
            console.debug("[QuoteEditor] Totals updated", {
                subtotal: computedTotals.subtotal,
                discount: computedTotals.discount,
                tax: computedTotals.tax,
                total: computedTotals.grandTotal,
            });
        }
    }, [computedTotals]);

    // ============================================================================
    // COMPUTED VALUES: Save/Convert Flags
    // ============================================================================

    const hasCustomer = !!selectedCustomer;
    const hasLineItems = lineItems.length > 0;
    const isExistingQuote = !!quoteId;

    const saveQuoteMutation = useMutation({
        mutationFn: async (payload: any) => {
            if (!quoteId) {
                throw new Error("Missing quote id");
            }

            const response = await apiRequest("PATCH", `/api/quotes/${quoteId}`, payload);
            return await response.json();
        },
        onSuccess: () => {
            toast({
                title: "Success",
                description: "Quote saved",
            });
            queryClient.invalidateQueries({ queryKey: ["/api/quotes"] });
            queryClient.invalidateQueries({ queryKey: ["/api/quotes", quoteId] });
        },
        onError: (error: Error) => {
            toast({
                title: "Error",
                description: error.message,
                variant: "destructive",
            });
        },
    });

    const isSaving = saveQuoteMutation.isPending;
    const canSaveNewQuote = isNewQuote && hasCustomer && hasLineItems;
    const canSaveExistingQuote = isExistingQuote && hasCustomer && hasLineItems;
    const canSaveQuote = (canSaveNewQuote || canSaveExistingQuote) && !isSaving;
    const canConvertToOrder = isExistingQuote && hasCustomer && hasLineItems;
    const canDuplicateQuote = isExistingQuote && hasLineItems;

    // ============================================================================
    // COMPUTED VALUES: Customer Info
    // ============================================================================

    const pricingTier = selectedCustomer?.pricingTier || 'default';
    const discountPercent = selectedCustomer?.defaultDiscountPercent ? Number(selectedCustomer.defaultDiscountPercent) : null;
    const markupPercent = selectedCustomer?.defaultMarkupPercent ? Number(selectedCustomer.defaultMarkupPercent) : null;
    const marginPercent = selectedCustomer?.defaultMarginPercent ? Number(selectedCustomer.defaultMarginPercent) : null;

    const customerHasAddress = selectedCustomer && (
        selectedCustomer.shippingStreet1 || selectedCustomer.billingStreet1 ||
        selectedCustomer.shippingCity || selectedCustomer.billingCity
    );

    // ============================================================================
    // EFFECT: Defensive redirect on quote load failure
    // ============================================================================

    useEffect(() => {
        if (quoteId && !quoteLoading && (!quote || quoteError)) {
            navigate(ROUTES.quotes.list);
        }
    }, [quoteId, quoteLoading, quote, quoteError, navigate]);

    // ============================================================================
    // EFFECT: Load existing quote data
    // ============================================================================

    useEffect(() => {
        // CRITICAL FIX: Only hydrate when quoteId changes, NOT on every refetch.
        // This prevents attachment upload (which refetches quote) from clobbering unsaved fields.
        if (!quote) return;
        if (!quoteId) return;
        if (hydratedQuoteIdRef.current === quoteId) return; // Already hydrated this quote

        // Mark as hydrated FIRST to prevent re-entrancy
        hydratedQuoteIdRef.current = quoteId;

        // Sync customer ID and contact ID
        if ((quote as any).customerId && !selectedCustomerId) {
            setSelectedCustomerId((quote as any).customerId);
        }
        if ((quote as any).contactId && !selectedContactId) {
            setSelectedContactId((quote as any).contactId);
        }

        // If quote includes customer data, populate selectedCustomer
        if ((quote as any).customer && !selectedCustomer) {
            setSelectedCustomer((quote as any).customer as CustomerWithContacts);
        }

        // Quote meta (label / due date / discount / fulfillment)
        const q: any = quote as any;
        setJobLabel(q.label || "");
        // Convert timestamp-ish value to YYYY-MM-DD if present
        if (q.requestedDueDate) {
            try {
                const d = new Date(q.requestedDueDate);
                if (!Number.isNaN(d.getTime())) {
                    const yyyy = d.getFullYear();
                    const mm = String(d.getMonth() + 1).padStart(2, "0");
                    const dd = String(d.getDate()).padStart(2, "0");
                    setRequestedDueDate(`${yyyy}-${mm}-${dd}`);
                }
            } catch {
                // ignore parse failures
            }
        } else {
            setRequestedDueDate("");
        }
        setDiscountAmount(Number.parseFloat(q.discountAmount || "0") || 0);
        
        // Hydrate fulfillment method from persisted shippingMethod
        const persistedShippingMethod = q.shippingMethod as string | null | undefined;
        if (persistedShippingMethod === "ship") {
            setDeliveryMethod("ship");
        } else if (persistedShippingMethod === "deliver") {
            setDeliveryMethod("deliver");
        } else {
            setDeliveryMethod("pickup");
        }
        
        // Hydrate shipping cost from persisted shippingCents
        setShippingCents(q.shippingCents ?? null);
        
        // Hydrate tags from listLabel (comma-separated string) - only once per quote load
        if (quoteId && quoteId !== hydratedTagsForQuoteIdRef.current) {
            const listLabel = q.listLabel as string | null | undefined;
            if (listLabel && typeof listLabel === 'string' && listLabel.trim()) {
                // Parse comma-separated string into array
                const parsedTags = listLabel
                    .split(/[,\n]/g)
                    .map(t => t.trim())
                    .filter(Boolean);
                
                // De-duplicate
                const uniqueTags: string[] = [];
                const seen = new Set<string>();
                for (const tag of parsedTags) {
                    const lower = tag.toLowerCase();
                    if (!seen.has(lower)) {
                        seen.add(lower);
                        uniqueTags.push(tag);
                    }
                }
                
                setTags(uniqueTags);
                if (process.env.NODE_ENV === 'development') {
                    console.log('[Quote Editor] Hydrated tags from listLabel:', uniqueTags);
                }
            } else {
                // No listLabel - start with empty tags
                setTags([]);
            }
            hydratedTagsForQuoteIdRef.current = quoteId;
        }
        
        // Load quote-level tax overrides if present
        setQuoteTaxExempt((q as any).quoteTaxExempt ?? null);
        setQuoteTaxRateOverride((q as any).quoteTaxRateOverride != null ? Number((q as any).quoteTaxRateOverride) : null);

        setLineItems((quote as any).lineItems?.map((item: any, idx: number) => ({
            id: item.id,
            productId: item.productId,
            productName: item.productName,
            variantId: item.variantId,
            variantName: item.variantName,
            productType: item.productType || 'wide_roll',
            status: (item as any).status || 'active',
            width: parseFloat(item.width),
            height: parseFloat(item.height),
            quantity: item.quantity,
            specsJson: item.specsJson || {},
            optionSelectionsJson: (item as any).optionSelectionsJson ?? null,
            selectedOptions: item.selectedOptions || [],
            linePrice: parseFloat(item.linePrice),
            // Price override fields are client-side for now; default to formula pricing on load.
            priceOverridden: false,
            overriddenPrice: null,
            formulaLinePrice: parseFloat(item.linePrice),
            priceBreakdown: item.priceBreakdown,
            displayOrder: idx,
            notes: (item.specsJson as any)?.notes || undefined,
            productOptions: (item as any).productOptions || (item as any).product?.optionsJson || [],
        })) || []);

        // Update discard snapshot when we load a quote (and only once per loaded quote data).
        savedSnapshotRef.current = {
            selectedCustomerId: (quote as any).customerId ?? null,
            selectedContactId: (quote as any).contactId ?? null,
            selectedCustomer: (quote as any).customer as CustomerWithContacts | undefined,
            deliveryMethod: (quote as any).shippingMethod === "ship" ? "ship" : (quote as any).shippingMethod === "deliver" ? "deliver" : "pickup",
            shippingCents: (quote as any).shippingCents ?? null,
            useCustomerAddress: false,
            shippingAddress: {
                street1: (quote as any).shipToAddress1 || "",
                street2: (quote as any).shipToAddress2 || "",
                city: (quote as any).shipToCity || "",
                state: (quote as any).shipToState || "",
                postalCode: (quote as any).shipToPostalCode || "",
                country: (quote as any).shipToCountry || "USA",
            },
            quoteNotes: (quote as any).shippingInstructions || "",
            jobLabel: (quote as any).label || "",
            tags: (quote as any).tags || [],
            quoteTaxExempt: (quote as any).quoteTaxExempt ?? null,
            quoteTaxRateOverride: (quote as any).quoteTaxRateOverride != null ? Number((quote as any).quoteTaxRateOverride) : null,
            requestedDueDate: (() => {
                const raw = (quote as any).requestedDueDate;
                if (!raw) return "";
                try {
                    const d = new Date(raw);
                    if (Number.isNaN(d.getTime())) return "";
                    const yyyy = d.getFullYear();
                    const mm = String(d.getMonth() + 1).padStart(2, "0");
                    const dd = String(d.getDate()).padStart(2, "0");
                    return `${yyyy}-${mm}-${dd}`;
                } catch {
                    return "";
                }
            })(),
            discountAmount: Number.parseFloat((quote as any).discountAmount || "0") || 0,
            lineItems: (quote as any).lineItems?.map((item: any, idx: number) => ({
                id: item.id,
                productId: item.productId,
                productName: item.productName,
                variantId: item.variantId,
                variantName: item.variantName,
                productType: item.productType || 'wide_roll',
                status: (item as any).status || 'active',
                width: parseFloat(item.width),
                height: parseFloat(item.height),
                quantity: item.quantity,
                specsJson: item.specsJson || {},
                optionSelectionsJson: (item as any).optionSelectionsJson ?? null,
                selectedOptions: item.selectedOptions || [],
                linePrice: parseFloat(item.linePrice),
                priceOverridden: false,
                overriddenPrice: null,
                formulaLinePrice: parseFloat(item.linePrice),
                priceBreakdown: item.priceBreakdown,
                displayOrder: idx,
                notes: (item.specsJson as any)?.notes || undefined,
                productOptions: (item as any).productOptions || (item as any).product?.optionsJson || [],
            })) || [],
        };
    }, [quote, quoteId]); // ONLY depend on quote and quoteId - removed individual field dependencies

    // ============================================================================
    // HANDLER: Inline price override (client-side only for now)
    // ============================================================================

    const setLineItemPriceOverride = useCallback((itemKey: string, nextPrice: number | null) => {
        if (!itemKey) return;

        setLineItems((prev) =>
            prev.map((item) => {
                const keyMatches = item.tempId === itemKey || item.id === itemKey;
                if (!keyMatches) return item;

                const formulaLinePrice = typeof item.formulaLinePrice === "number" ? item.formulaLinePrice : item.linePrice;

                if (nextPrice == null) {
                    // TODO: log price override to audit log
                    const restored = formulaLinePrice;
                    return {
                        ...item,
                        priceOverridden: false,
                        overriddenPrice: null,
                        linePrice: restored,
                        priceBreakdown: {
                            ...(item.priceBreakdown || {}),
                            basePrice: restored,
                            total: restored,
                        },
                    };
                }

                const sanitized = Number.isFinite(nextPrice) ? Math.max(0, nextPrice) : 0;

                // TODO: log price override to audit log
                return {
                    ...item,
                    formulaLinePrice,
                    priceOverridden: true,
                    overriddenPrice: sanitized,
                    linePrice: sanitized,
                    priceBreakdown: {
                        ...(item.priceBreakdown || {}),
                        basePrice: sanitized,
                        total: sanitized,
                    },
                };
            })
        );
    }, []);

    // ============================================================================
    // EFFECT: Update selectedCustomer when customerData is fetched
    // ============================================================================

    useEffect(() => {
        if (customerData && !selectedCustomer) {
            setSelectedCustomer(customerData);
        }
    }, [customerData, selectedCustomer]);

    // ============================================================================
    // EFFECT: Populate form when editing a line item
    // ============================================================================

    useEffect(() => {
        if (draftLineItemId && lineItems.length > 0) {
            const itemToEdit = lineItems.find(item => item.id === draftLineItemId);
            if (itemToEdit) {
                setSelectedProductId(itemToEdit.productId);
                setSelectedVariantId(itemToEdit.variantId);
                setWidth(String(itemToEdit.width));
                setHeight(String(itemToEdit.height));
                setQuantity(String(itemToEdit.quantity));
                setLineItemNotes(itemToEdit.notes || '');

                // Populate option selections if available
                if (itemToEdit.selectedOptions && Array.isArray(itemToEdit.selectedOptions)) {
                    const selections: Record<string, any> = {};
                    itemToEdit.selectedOptions.forEach((opt: any) => {
                        selections[opt.optionId] = {
                            value: opt.value,
                            grommetsLocation: opt.grommetsLocation,
                            grommetsSpacingCount: opt.grommetsSpacingCount,
                            grommetsPerSign: opt.grommetsPerSign,
                            grommetsSpacingInches: opt.grommetsSpacingInches,
                            customPlacementNote: opt.customPlacementNote,
                            hemsType: opt.hemsType,
                            polePocket: opt.polePocket,
                        };
                    });
                    setOptionSelections(selections);
                }
            }
        }
    }, [draftLineItemId, lineItems]);

    // ============================================================================
    // EFFECT: Debug product options
    // ============================================================================

    useEffect(() => {
        if (selectedProduct) {
            console.log('[useQuoteEditorState] Selected product:', selectedProduct.name);
            console.log('[useQuoteEditorState] Product optionsJson:', selectedProduct.optionsJson);
            console.log('[useQuoteEditorState] Options length:', (selectedProduct.optionsJson as ProductOptionItem[])?.length || 0);
        }
    }, [selectedProduct]);

    // ============================================================================
    // HELPER: Upload attachment to line item
    // ============================================================================

    /**
     * Upload a single file attachment to a line item.
     * Reuses the same upload flow as LineItemAttachmentsPanel for consistency.
     */
    const uploadLineItemAttachment = useCallback(
        async (file: File, lineItemId: string, quoteId: string | null): Promise<void> => {
            // Step 1: Get signed upload URL from backend
            const urlResponse = await fetch("/api/objects/upload", {
                method: "POST",
                credentials: "include",
            });

            if (!urlResponse.ok) {
                throw new Error("Failed to get upload URL");
            }

            const { url, method } = await urlResponse.json();

            // Step 2: Upload file to storage
            const uploadResponse = await fetch(url, {
                method: method || "PUT",
                body: file,
                headers: {
                    "Content-Type": file.type || "application/octet-stream",
                },
            });

            if (!uploadResponse.ok) {
                throw new Error(`Failed to upload ${file.name}`);
            }

            // Step 3: Extract the file URL (remove query params)
            const fileUrl = url.split("?")[0];

            // Step 4: Attach file to line item
            const filesApiPath = quoteId
                ? `/api/quotes/${quoteId}/line-items/${lineItemId}/files`
                : `/api/line-items/${lineItemId}/files`;

            const attachResponse = await fetch(filesApiPath, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({
                    fileName: file.name,
                    fileUrl,
                    fileSize: file.size,
                    mimeType: file.type,
                }),
            });

            if (!attachResponse.ok) {
                throw new Error(`Failed to attach ${file.name}`);
            }
        },
        []
    );

    // ============================================================================
    // HELPER: Build selected options payload
    // ============================================================================

    const buildSelectedOptionsPayload = useCallback(() => {
        const payload: Record<string, any> = {};
        Object.entries(optionSelections).forEach(([optionId, selection]) => {
            payload[optionId] = {
                value: selection.value,
                grommetsLocation: selection.grommetsLocation,
                grommetsSpacingCount: selection.grommetsSpacingCount,
                grommetsPerSign: selection.grommetsPerSign,
                grommetsSpacingInches: selection.grommetsSpacingInches,
                customPlacementNote: selection.customPlacementNote,
                hemsType: selection.hemsType,
                polePocket: selection.polePocket,
            };
        });
        return payload;
    }, [optionSelections]);

    // ============================================================================
    // HELPER: Patch draft line item
    // ============================================================================

    const patchDraftLineItem = useCallback(
        async (updates: Record<string, any>) => {
            if (!quoteId || !draftLineItemId) return;
            try {
                await apiRequest("PATCH", `/api/quotes/${quoteId}/line-items/${draftLineItemId}`, updates);
            } catch (err) {
                console.error("Failed to patch draft line item", err);
            }
        },
        [quoteId, draftLineItemId]
    );

    // ============================================================================
    // EFFECT: Sync selected options to draft line item
    // ============================================================================

    useEffect(() => {
        if (!draftLineItemId || !quoteId || !selectedProduct) return;
        const productOptionsForSync = productOptions;
        const selectedOptionsArray: Array<{
            optionId: string;
            optionName: string;
            value: string | number | boolean;
            note?: string;
            setupCost: number;
            calculatedCost: number;
        }> = [];

        const widthVal = requiresDimensions ? parseFloat(width || "0") : 1;
        const heightVal = requiresDimensions ? parseFloat(height || "0") : 1;
        const quantityVal = parseInt(quantity || "1", 10) || 1;

        productOptionsForSync.forEach((option) => {
            const selection = optionSelections[option.id];
            if (!selection) return;

            const optionAmount = option.amount || 0;
            let setupCost = 0;
            let calculatedCost = 0;

            if (option.priceMode === "flat") {
                setupCost = optionAmount;
                calculatedCost = optionAmount;
            } else if (option.priceMode === "per_qty") {
                calculatedCost = optionAmount * quantityVal;
            } else if (option.priceMode === "per_sqft") {
                const sqft = widthVal * heightVal;
                calculatedCost = optionAmount * sqft * quantityVal;
            }

            if (option.config?.kind === "grommets" && selection.grommetsLocation) {
                if (
                    selection.grommetsLocation === "top_even" &&
                    selection.grommetsSpacingCount
                ) {
                    calculatedCost *= selection.grommetsSpacingCount;
                }
            }

            selectedOptionsArray.push({
                optionId: option.id,
                optionName: option.label,
                value: selection.value,
                note: typeof (selection as any).note === "string" ? (selection as any).note : undefined,
                setupCost,
                calculatedCost,
            });
        });

        patchDraftLineItem({ selectedOptions: selectedOptionsArray });
    }, [draftLineItemId, quoteId, optionSelections, selectedProduct, productOptions, requiresDimensions, width, height, quantity, patchDraftLineItem]);

    // ============================================================================
    // AUTO-CALCULATE PRICE
    // ============================================================================

    const triggerAutoCalculate = useCallback(async () => {
        // Check if all required fields are present and valid
        if (!selectedProductId || !quantity) {
            setCalculatedPrice(null);
            setCalcError(null);
            return;
        }

        // For dimension-requiring products, also need width/height
        if (requiresDimensions && (!width || !height)) {
            setCalculatedPrice(null);
            setCalcError(null);
            return;
        }

        const widthNum = requiresDimensions ? parseFloat(width) : 1;
        const heightNum = requiresDimensions ? parseFloat(height) : 1;
        const quantityNum = parseInt(quantity);

        if (requiresDimensions && (isNaN(widthNum) || widthNum <= 0 || isNaN(heightNum) || heightNum <= 0)) {
            setCalculatedPrice(null);
            setCalcError(null);
            return;
        }

        if (isNaN(quantityNum) || quantityNum <= 0) {
            setCalculatedPrice(null);
            setCalcError(null);
            return;
        }

        // Cancel previous request
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            if (import.meta.env.DEV) {
                console.debug(`[CALC] Aborted previous request before starting #${calcRequestIdRef.current + 1}`);
            }
        }

        // Create new AbortController and increment request ID
        const controller = new AbortController();
        abortControllerRef.current = controller;
        calcRequestIdRef.current += 1;
        const requestId = calcRequestIdRef.current;

        // Build input hash for staleness detection
        const inputHash = JSON.stringify({
            productId: selectedProductId,
            variantId: selectedVariantId,
            width: widthNum,
            height: heightNum,
            quantity: quantityNum,
            options: buildSelectedOptionsPayload(),
            customerId: selectedCustomerId,
            quoteId,
        });

        setIsCalculating(true);
        // DO NOT clear calculatedPrice - keep last known price visible
        // DO NOT clear calcError here - will be cleared on success

        try {
            // Detect PBV2 product
            const selectedProduct = products?.find((p: any) => p.id === selectedProductId);
            const isPbv2 = selectedProduct?.optionTreeJson && 
                typeof selectedProduct.optionTreeJson === 'object' && 
                (selectedProduct.optionTreeJson as any)?.schemaVersion === 2;

            const payload: any = {
                productId: selectedProductId,
                variantId: selectedVariantId,
                width: widthNum,
                height: heightNum,
                quantity: quantityNum,
                customerId: selectedCustomerId,
                quoteId,
            };

            if (isPbv2) {
                // PBV2: send optionSelectionsJson (useQuoteEditorState doesn't support PBV2 options yet, send empty)
                payload.optionSelectionsJson = { schemaVersion: 2, selected: {} };
            } else {
                // Legacy: send selectedOptions
                payload.selectedOptions = buildSelectedOptionsPayload();
            }

            const response = await apiRequest(
                "POST",
                "/api/quotes/calculate",
                payload,
                { signal: controller.signal }
            );

            // Check if this response is stale
            if (requestId !== calcRequestIdRef.current) {
                if (import.meta.env.DEV) {
                    console.debug(`[CALC] Ignored stale response #${requestId}, latest is #${calcRequestIdRef.current}`);
                }
                return;
            }

            const data = await response.json();
            setCalculatedPrice(data.price);
            setCalcError(null);
            lastCalcInputsHashRef.current = inputHash;
        } catch (error) {
            // Ignore AbortError (expected when cancelling)
            if (error instanceof Error && error.name === "AbortError") {
                return;
            }

            // Only update error if this is still the latest request
            if (requestId === calcRequestIdRef.current) {
                setCalcError(error instanceof Error ? error.message : "Calculation failed");
                // Keep calculatedPrice as-is (preserve last known valid price)
            }
        } finally {
            // Only clear calculating flag if this is still the latest request
            if (requestId === calcRequestIdRef.current) {
                setIsCalculating(false);
            }
        }
    }, [selectedProductId, selectedVariantId, width, height, quantity, requiresDimensions, buildSelectedOptionsPayload, selectedCustomerId, quoteId]);

    const repriceExistingLineItemsForCustomer = useCallback(async (nextCustomerId: string | null) => {
        const itemsToReprice = lineItems.filter((li) => li.status !== "canceled" && !li.priceOverridden);
        if (!nextCustomerId || itemsToReprice.length === 0) {
            setPricingStale(false);
            return;
        }

        const requestId = (repricingRequestIdRef.current += 1);
        setPricingStale(true);
        setIsRepricingLineItems(true);

        try {
            const results = await Promise.all(
                itemsToReprice.map(async (li) => {
                    const key = getStableLineItemKey(li);
                    
                    // Detect PBV2 product
                    const product = products?.find((p: any) => p.id === li.productId);
                    const isPbv2 = product?.optionTreeJson && 
                        typeof product.optionTreeJson === 'object' && 
                        (product.optionTreeJson as any)?.schemaVersion === 2;

                    const payload: any = {
                        productId: li.productId,
                        variantId: li.variantId,
                        width: li.width,
                        height: li.height,
                        quantity: li.quantity,
                        customerId: nextCustomerId,
                        quoteId,
                    };

                    if (isPbv2) {
                        // PBV2: send optionSelectionsJson from line item or empty
                        payload.optionSelectionsJson = (li as any).optionSelectionsJson ?? { schemaVersion: 2, selected: {} };
                    } else {
                        // Legacy: send selectedOptions
                        payload.selectedOptions = li.selectedOptions;
                    }

                    const response = await apiRequest("POST", "/api/quotes/calculate", payload);
                    const data = await response.json();
                    const price = Number(data?.price);
                    if (!Number.isFinite(price)) return { key, ok: false as const };
                    return { key, ok: true as const, price, priceBreakdown: data?.breakdown };
                })
            );

            if (requestId !== repricingRequestIdRef.current) return;

            const byKey = new Map<string, { price: number; priceBreakdown: any }>();
            for (const r of results) {
                if (r.ok) byKey.set(r.key, { price: r.price, priceBreakdown: r.priceBreakdown });
            }

            setLineItems((prev) =>
                prev.map((li) => {
                    if (li.status === "canceled" || li.priceOverridden) return li;
                    const key = getStableLineItemKey(li);
                    const hit = byKey.get(key);
                    if (!hit) return li;
                    return {
                        ...li,
                        linePrice: hit.price,
                        formulaLinePrice: hit.price,
                        priceBreakdown:
                            hit.priceBreakdown ||
                            ({
                                ...(li.priceBreakdown || {}),
                                basePrice: hit.price,
                                total: hit.price,
                            } as any),
                    };
                })
            );

            setPricingStale(false);
        } catch {
            if (requestId !== repricingRequestIdRef.current) return;
            setPricingStale(true);
        } finally {
            if (requestId === repricingRequestIdRef.current) {
                setIsRepricingLineItems(false);
            }
        }
    }, [lineItems, quoteId]);

    // ============================================================================
    // EFFECT: Debounced auto-calculation
    // ============================================================================

    useEffect(() => {
        // Clear existing timer
        if (debounceTimerRef.current) {
            clearTimeout(debounceTimerRef.current);
        }

        // Set new timer for 200ms debounce (faster response)
        debounceTimerRef.current = setTimeout(() => {
            triggerAutoCalculate();
        }, 200);

        // Cleanup: clear timer and abort any in-flight request
        return () => {
            if (debounceTimerRef.current) {
                clearTimeout(debounceTimerRef.current);
            }
            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
            }
        };
    }, [triggerAutoCalculate]);

    // ============================================================================
    // HANDLER: Add Line Item
    // ============================================================================

    const handleAddLineItem = async (pendingAttachments?: File[]) => {
        if (!selectedProductId) return;

        const product = products?.find((p) => p.id === selectedProductId);
        const variant = productVariants?.find((v) => v.id === selectedVariantId);

        // Dimensions
        const widthVal = requiresDimensions ? parseFloat(width) : 1;
        const heightVal = requiresDimensions ? parseFloat(height) : 1;
        const quantityVal = parseInt(quantity || "1", 10);

        // Build selectedOptions array from optionSelections
        const selectedOptionsArray: Array<{
            optionId: string;
            optionName: string;
            value: string | number | boolean;
            note?: string;
            setupCost: number;
            calculatedCost: number;
        }> = [];

        const productOptions = (product?.optionsJson as ProductOptionItem[]) || [];

        productOptions.forEach((option) => {
            const selection = optionSelections[option.id];
            if (!selection) return;

            const optionAmount = option.amount || 0;
            let setupCost = 0;
            let calculatedCost = 0;

            if (option.priceMode === "flat") {
                setupCost = optionAmount;
                calculatedCost = optionAmount;
            } else if (option.priceMode === "per_qty") {
                calculatedCost = optionAmount * quantityVal;
            } else if (option.priceMode === "per_sqft") {
                const sqft = widthVal * heightVal;
                calculatedCost = optionAmount * sqft * quantityVal;
            }

            if (option.config?.kind === "grommets" && selection.grommetsLocation) {
                if (
                    selection.grommetsLocation === "top_even" &&
                    selection.grommetsSpacingCount
                ) {
                    calculatedCost *= selection.grommetsSpacingCount;
                }
            }

            selectedOptionsArray.push({
                optionId: option.id,
                optionName: option.label,
                value: selection.value,
                note: typeof (selection as any).note === "string" ? (selection as any).note : undefined,
                setupCost,
                calculatedCost,
            });
        });

        // CRITICAL TEMP → PERMANENT BOUNDARY: Do not allow persisting null/zero price
        if (calculatedPrice === null) {
            setCalcError("Price is not calculated yet. Fix inputs or wait for calculation.");
            toast({
                title: "Cannot add line item",
                description: "Price calculation is not complete. Please wait or fix validation errors.",
                variant: "destructive",
            });
            return;
        }

        const linePrice = calculatedPrice;

        // If we have a draft line item and a quoteId, promote it to active
        if (draftLineItemId && quoteId) {
            const payload = {
                productId: selectedProductId,
                productName: product?.name || "",
                variantId: selectedVariantId,
                variantName: variant?.name || null,
                productType: "wide_roll",
                width: widthVal,
                height: heightVal,
                quantity: quantityVal,
                specsJson: lineItemNotes ? { notes: lineItemNotes } : {},
                selectedOptions: selectedOptionsArray,
                linePrice,
                priceBreakdown: {
                    basePrice: linePrice,
                    optionsPrice: 0,
                    total: linePrice,
                    formula: "",
                },
                displayOrder: lineItems.length,
                status: "active" as const,
            };

            try {
                await apiRequest("PATCH", `/api/quotes/${quoteId}/line-items/${draftLineItemId}`, payload);

                // Upload pending attachments after line item is created
                if (pendingAttachments && pendingAttachments.length > 0) {
                    let successCount = 0;
                    let errorCount = 0;

                    for (const file of pendingAttachments) {
                        try {
                            await uploadLineItemAttachment(file, draftLineItemId, quoteId);
                            successCount++;
                        } catch (fileError: any) {
                            console.error(`Error uploading ${file.name}:`, fileError);
                            errorCount++;
                        }
                    }

                    // Refresh queries to show uploaded attachments
                    if (successCount > 0) {
                        queryClientInstance.invalidateQueries({
                            queryKey: [`/api/quotes/${quoteId}/line-items/${draftLineItemId}/files`]
                        });
                    }

                    // Show upload results
                    if (errorCount > 0) {
                        toast({
                            title: "Some Attachments Failed",
                            description: `${errorCount} file${errorCount !== 1 ? "s" : ""} failed to upload. You can re-add them via the paperclip icon.`,
                            variant: "destructive",
                        });
                    }
                }

                const newItem: QuoteLineItemDraft = {
                    id: draftLineItemId,
                    productId: payload.productId,
                    productName: payload.productName,
                    variantId: payload.variantId || null,
                    variantName: payload.variantName || null,
                    productType: payload.productType,
                    width: payload.width,
                    height: payload.height,
                    quantity: payload.quantity,
                    specsJson: payload.specsJson,
                    selectedOptions: payload.selectedOptions,
                    linePrice: payload.linePrice,
                    priceOverridden: false,
                    overriddenPrice: null,
                    formulaLinePrice: payload.linePrice,
                    priceBreakdown: payload.priceBreakdown,
                    displayOrder: payload.displayOrder,
                    notes: lineItemNotes || undefined,
                    productOptions: product?.optionsJson as ProductOptionItem[] | undefined,
                    status: "active",
                };
                setLineItems([...lineItems, newItem]);
                setDraftLineItemId(null);
                setSelectedProductId("");
                setSelectedVariantId(null);
                setWidth("");
                setHeight("");
                setQuantity("1");
                setCalculatedPrice(null);
                setCalcError(null);
                setOptionSelections({});
                setOptionSelectionsJson({ schemaVersion: 2, selected: {} });
                setLineItemNotes("");
            } catch (error: any) {
                toast({
                    title: "Error",
                    description: error.message || "Failed to publish line item",
                    variant: "destructive",
                });
            }
            return;
        }

        // Fallback to old behavior (no draft present or no quoteId)
        try {
            const response = await apiRequest("POST", "/api/line-items/temp", {
                productId: selectedProductId,
                productName: product?.name || "",
                variantId: selectedVariantId,
                variantName: variant?.name || null,
                productType: "wide_roll",
                width: widthVal,
                height: heightVal,
                quantity: quantityVal,
                specsJson: lineItemNotes ? { notes: lineItemNotes } : {},
                selectedOptions: selectedOptionsArray,
                linePrice,
                priceBreakdown: {
                    basePrice: linePrice,
                    optionsPrice: 0,
                    total: linePrice,
                    formula: "",
                },
                displayOrder: lineItems.length,
            });
            if (!response.ok) {
                throw new Error("Failed to create temporary line item");
            }

            const json = await response.json();
            const createdLineItem = json.data;

            if (!createdLineItem || !createdLineItem.id) {
                throw new Error("Server did not return a valid line item id");
            }

            // Upload pending attachments after line item is created
            if (pendingAttachments && pendingAttachments.length > 0) {
                let successCount = 0;
                let errorCount = 0;

                for (const file of pendingAttachments) {
                    try {
                        await uploadLineItemAttachment(file, createdLineItem.id, null);
                        successCount++;
                    } catch (fileError: any) {
                        console.error(`Error uploading ${file.name}:`, fileError);
                        errorCount++;
                    }
                }

                // Refresh queries to show uploaded attachments
                if (successCount > 0) {
                    queryClientInstance.invalidateQueries({
                        queryKey: [`/api/line-items/${createdLineItem.id}/files`]
                    });
                }

                // Show upload results
                if (errorCount > 0) {
                    toast({
                        title: "Some Attachments Failed",
                        description: `${errorCount} file${errorCount !== 1 ? "s" : ""} failed to upload. You can re-add them via the paperclip icon.`,
                        variant: "destructive",
                    });
                }
            }

            const newItem: QuoteLineItemDraft = {
                id: createdLineItem.id,
                productId: selectedProductId,
                productName: product?.name || "",
                variantId: selectedVariantId || null,
                variantName: variant?.name || null,
                productType: "wide_roll",
                width: widthVal,
                height: heightVal,
                quantity: quantityVal,
                specsJson: lineItemNotes ? { notes: lineItemNotes } : {},
                selectedOptions: selectedOptionsArray,
                linePrice,
                priceOverridden: false,
                overriddenPrice: null,
                formulaLinePrice: linePrice,
                priceBreakdown: {
                    basePrice: linePrice,
                    optionsPrice: 0,
                    total: linePrice,
                    formula: "",
                },
                displayOrder: lineItems.length,
                notes: lineItemNotes || undefined,
                productOptions: product?.optionsJson as ProductOptionItem[] | undefined,
                status: (createdLineItem as any).status || "active",
            };

            setLineItems([...lineItems, newItem]);

            setSelectedProductId("");
            setSelectedVariantId(null);
            setWidth("");
            setHeight("");
            setQuantity("1");
            setCalculatedPrice(null);
            setCalcError(null);
            setOptionSelections({});
            setOptionSelectionsJson({ schemaVersion: 2, selected: {} });
            setLineItemNotes("");
        } catch (error: any) {
            console.error("Error creating temporary line item:", error);
            toast({
                title: "Error",
                description: error.message || "Failed to add line item",
                variant: "destructive",
            });
        }
    };

    // ============================================================================
    // HANDLER: Duplicate Line Item
    // ============================================================================

    const handleDuplicateLineItem = (itemId: string) => {
        const item = lineItems.find(i => (i.tempId || i.id) === itemId);
        if (!item) return;

        const duplicatedItem: QuoteLineItemDraft = {
            ...item,
            tempId: `temp-${Date.now()}`,
            id: undefined,
            displayOrder: lineItems.length,
        };

        setLineItems([...lineItems, duplicatedItem]);
        toast({
            title: "Line Item Duplicated",
            description: "Item duplicated successfully",
        });
    };

    // ============================================================================
    // HANDLER: Remove Line Item
    // ============================================================================

    const handleRemoveLineItem = (tempId: string) => {
        setLineItems(lineItems.filter(item => item.tempId !== tempId && item.id !== tempId));
    };

    // ============================================================================
    // HANDLER: Copy customer address to shipping
    // ============================================================================

    const handleCopyCustomerAddress = (checked: boolean) => {
        setUseCustomerAddress(checked);
        if (checked && selectedCustomer) {
            setShippingAddress({
                street1: selectedCustomer.shippingStreet1 || selectedCustomer.billingStreet1 || '',
                street2: selectedCustomer.shippingStreet2 || selectedCustomer.billingStreet2 || '',
                city: selectedCustomer.shippingCity || selectedCustomer.billingCity || '',
                state: selectedCustomer.shippingState || selectedCustomer.billingState || '',
                postalCode: selectedCustomer.shippingPostalCode || selectedCustomer.billingPostalCode || '',
                country: selectedCustomer.shippingCountry || selectedCustomer.billingCountry || 'USA'
            });
        }
    };

    // ============================================================================
    // HANDLER: Build quote payload
    // ============================================================================

    const buildQuotePayload = () => {
        if (!quoteId) {
            throw new Error("Missing quote id");
        }

        const payloadCustomerId = selectedCustomer?.id ?? selectedCustomerId ?? (quote as any)?.customerId ?? null;
        const payloadHasCustomerId = !!payloadCustomerId;
        const payloadHasLineItems = lineItems.length > 0;

        return {
            customerId: payloadCustomerId,
            contactId: selectedContactId ?? null,
            customerName: selectedCustomer?.companyName ?? (quote as any)?.customerName ?? null,
            subtotal,
            taxRate: effectiveTaxRate,
            taxAmount,
            discountAmount: effectiveDiscount,
            totalPrice: grandTotal,
            label: jobLabel || null,
            requestedDueDate: requestedDueDate ? new Date(`${requestedDueDate}T00:00:00.000Z`).toISOString() : null,
            shippingMethod: deliveryMethod,
            shippingCents: shippingCents,
            shippingInstructions: quoteNotes || null,
            source: "internal",
            hasCustomerId: payloadHasCustomerId,
            hasLineItems: payloadHasLineItems,
            // Tags and tax overrides (backend may not support yet, but include in payload)
            tags: tags, // Always include tags array (empty array if no tags)
            quoteTaxExempt: quoteTaxExempt ?? undefined,
            quoteTaxRateOverride: quoteTaxRateOverride ?? undefined,
        };
    };

    // ============================================================================
    // HANDLER: Validate quote
    // ============================================================================

    const validateQuote = (q: any): string | null => {
        if (!q?.customerId) return "Please select a customer.";
        if (!q?.lineItems || q.lineItems.length === 0) return "Please add at least one line item.";
        return null;
    };

    // ============================================================================
    // HANDLER: Save Quote
    // ============================================================================

    const handleSaveQuote = async (): Promise<SaveQuoteResult> => {
        const payloadCustomerId = selectedCustomer?.id ?? selectedCustomerId ?? (quote as any)?.customerId ?? null;
        const payloadHasCustomerId = !!payloadCustomerId;
        const payloadHasLineItems = lineItems.length > 0;

        const workingQuote = {
            customerId: payloadCustomerId,
            contactId: selectedContactId ?? null,
            customerName: selectedCustomer?.companyName ?? (quote as any)?.customerName ?? null,
            lineItems,
            subtotal,
            taxRate: effectiveTaxRate,
            taxAmount,
            discountAmount: effectiveDiscount,
            totalPrice: grandTotal,
            label: jobLabel || null,
            requestedDueDate: requestedDueDate ? new Date(`${requestedDueDate}T00:00:00.000Z`).toISOString() : null,
            shippingMethod: deliveryMethod,
            shippingInstructions: quoteNotes || null,
            source: "internal",
            hasCustomerId: payloadHasCustomerId,
            hasLineItems: payloadHasLineItems,
            // Tags and tax overrides (backend may not support yet, but include in payload)
            tags: tags, // Always include tags array (empty array if no tags)
            quoteTaxExempt: quoteTaxExempt ?? undefined,
            quoteTaxRateOverride: quoteTaxRateOverride ?? undefined,
        };

        const error = validateQuote(workingQuote);
        if (error) {
            toast({
                title: "Cannot save quote",
                description: error,
                variant: "destructive",
            });
            throw new Error(error);
        }

        try {
            if (isNewQuote) {
                const response = await apiRequest("POST", "/api/quotes", workingQuote);
                if (!response.ok) {
                    const errorBody = await response.json().catch(() => ({}));
                    throw new Error(errorBody?.message || "Failed to create quote");
                }
                const created = await response.json();
                const newId =
                    created?.id ||
                    created?.quote?.id ||
                    created?.data?.id ||
                    created?.data?.quote?.id;
                const newQuoteNumber =
                    created?.quoteNumber ||
                    created?.quote?.quoteNumber ||
                    created?.data?.quoteNumber ||
                    created?.data?.quote?.quoteNumber;
                if (!newId) throw new Error("Quote creation did not return an id");

                toast({ title: "Quote saved", description: "Your new quote has been created." });
                queryClientInstance.invalidateQueries({ queryKey: ["/api/quotes"] });
                
                // Adopt this quote as canonical immediately to prevent duplicate creation
                setImperativeQuoteId(newId);

                // Return result instead of navigating
                return { kind: "created", quoteId: newId, quoteNumber: newQuoteNumber };
            } else {
                const payload = buildQuotePayload();
                await saveQuoteMutation.mutateAsync(payload);

                // Persist line item updates (create/update/delete) to match the current UI state.
                // This is required to support "Discard" semantics and avoid auto-saving as the user types.
                const snapshot = savedSnapshotRef.current;
                const prevIds = new Set((snapshot?.lineItems || []).map((li) => li.id).filter(Boolean) as string[]);
                const nextIds = new Set(lineItems.map((li) => li.id).filter(Boolean) as string[]);

                // Deletes
                const deletedIds = Array.from(prevIds).filter((id) => !nextIds.has(id));
                await Promise.all(
                    deletedIds.map((id) =>
                        apiRequest("DELETE", `/api/quotes/${quoteId}/line-items/${id}`).catch((err) => {
                            console.error("[saveQuote] Failed deleting line item", { id, err });
                        })
                    )
                );

                // Creates + Updates
                for (const li of lineItems) {
                    // Skip drafts with no product (placeholder)
                    if (!li.productId) continue;

                    const payloadLi: any = {
                        productId: li.productId,
                        productName: li.productName,
                        variantId: li.variantId ?? null,
                        variantName: li.variantName ?? null,
                        productType: li.productType || "wide_roll",
                        width: li.width,
                        height: li.height,
                        quantity: li.quantity,
                        specsJson: li.specsJson || {},
                        selectedOptions: li.selectedOptions || [],
                        linePrice: li.linePrice ?? 0,
                        priceBreakdown: li.priceBreakdown || {
                            basePrice: li.linePrice ?? 0,
                            optionsPrice: 0,
                            total: li.linePrice ?? 0,
                            formula: "",
                        },
                        displayOrder: li.displayOrder ?? 0,
                        status: li.status === "canceled" ? "canceled" : "active",
                    };

                    if (li.id) {
                        await apiRequest("PATCH", `/api/quotes/${quoteId}/line-items/${li.id}`, payloadLi).catch((err) => {
                            console.error("[saveQuote] Failed updating line item", { id: li.id, err });
                        });
                    } else {
                        await apiRequest("POST", `/api/quotes/${quoteId}/line-items`, payloadLi)
                            .then(async (resp) => await resp.json())
                            .then((created) => {
                                const createdId = created?.id || created?.data?.id;
                                if (createdId) {
                                    setLineItems((prev) =>
                                        prev.map((x) => (x.tempId && x.tempId === li.tempId ? { ...x, id: createdId } : x))
                                    );
                                }
                            })
                            .catch((err) => {
                                console.error("[saveQuote] Failed creating line item", { tempId: li.tempId, err });
                            });
                    }
                }

                toast({
                    title: "Quote saved",
                    description: "Your changes to this quote have been saved.",
                });
                queryClientInstance.invalidateQueries({ queryKey: ["/api/quotes"] });
                queryClientInstance.invalidateQueries({ queryKey: ["/api/quotes", quoteId] });

                // Update snapshot to current state (for discard behavior)
                savedSnapshotRef.current = {
                    selectedCustomerId: payloadCustomerId,
                    selectedContactId: selectedContactId ?? null,
                    selectedCustomer,
                    deliveryMethod,
                    shippingCents,
                    useCustomerAddress,
                    shippingAddress,
                    quoteNotes,
                    jobLabel,
                    requestedDueDate,
                    discountAmount: effectiveDiscount,
                    tags,
                    quoteTaxExempt,
                    quoteTaxRateOverride,
                    lineItems: lineItems.map((li) => ({ ...li, status: li.status === "canceled" ? "canceled" : "active" })),
                };

                // Return result for existing quote
                return { kind: "updated", quoteId: quoteId!, quoteNumber: (quote as any)?.quoteNumber };
            }
        } catch (error: any) {
            console.error("Save quote failed", error);
            toast({
                title: "Failed to save quote",
                description: error?.message || "Please try again.",
                variant: "destructive",
            });
            throw error;
        }
    };

    // ============================================================================
    // HANDLER: Duplicate Quote (v1 - normal duplicate only)
    // ============================================================================

    /**
     * Duplicate Quote v1 (normal duplicate only).
     *
     * Non-negotiables / v1 scope:
     * - No backend/schema/migration changes
     * - We intentionally do NOT copy attachments/files (stored separately from line items)
     * - We intentionally do NOT copy any "variant quote" metadata (not part of v1)
     *
     * Backend constraint: POST /api/quotes requires at least 1 line item.
     * So we create the new quote with the first line item, then sequentially POST the remaining
     * line items to /api/quotes/:id/line-items, and finally PATCH totals (existing mechanism).
     */
    const duplicateQuote = useCallback(async () => {
        if (!quoteId || !quote) {
            toast({
                title: "Cannot duplicate",
                description: "This quote is not fully loaded yet.",
                variant: "destructive",
            });
            return;
        }

        const sourceQuote: any = quote as any;

        const itemsToCopy = lineItems
            .filter((li) => li.status !== "draft")
            .map((li) => ({
                productId: li.productId,
                productName: li.productName,
                variantId: li.variantId || null,
                variantName: li.variantName || null,
                productType: li.productType || "wide_roll",
                status: li.status || "active",
                width: li.width,
                height: li.height,
                quantity: li.quantity,
                specsJson: li.specsJson || {},
                selectedOptions: Array.isArray(li.selectedOptions) ? li.selectedOptions : [],
                linePrice: li.linePrice ?? 0,
                priceBreakdown: li.priceBreakdown || {
                    basePrice: li.linePrice ?? 0,
                    optionsPrice: 0,
                    total: li.linePrice ?? 0,
                    formula: "",
                },
                displayOrder: li.displayOrder ?? 0,
            }));

        if (itemsToCopy.length === 0) {
            toast({
                title: "Cannot duplicate",
                description: "This quote has no line items to copy.",
                variant: "destructive",
            });
            return;
        }

        const payloadCustomerId = selectedCustomer?.id ?? selectedCustomerId ?? sourceQuote.customerId ?? null;
        const payloadHasCustomerId = !!payloadCustomerId;
        if (!payloadHasCustomerId) {
            toast({
                title: "Cannot duplicate",
                description: "This quote has no customer selected.",
                variant: "destructive",
            });
            return;
        }

        setIsDuplicatingQuote(true);
        toast({ title: "Duplicating…", description: "Creating a new quote copy." });

        let newQuoteId: string | null = null;
        let createdCount = 0;

        try {
            const firstLineItem = itemsToCopy[0];

            // Quote-level fields we attempt to copy in v1 (safe set):
            // - customerId/contactId
            // - shippingMethod/shippingMode/carrier fields (if present)
            // - billTo*/shipTo* snapshot fields (if present)
            //
            // Note: server currently re-snapshots billTo*/shipTo* on create; we pass through
            // customerId/contactId + shippingMethod/shippingMode so the snapshot should align.
            const snapshotFields = {
                billToName: sourceQuote.billToName ?? null,
                billToCompany: sourceQuote.billToCompany ?? null,
                billToAddress1: sourceQuote.billToAddress1 ?? null,
                billToAddress2: sourceQuote.billToAddress2 ?? null,
                billToCity: sourceQuote.billToCity ?? null,
                billToState: sourceQuote.billToState ?? null,
                billToPostalCode: sourceQuote.billToPostalCode ?? null,
                billToCountry: sourceQuote.billToCountry ?? null,
                billToPhone: sourceQuote.billToPhone ?? null,
                billToEmail: sourceQuote.billToEmail ?? null,
                shipToName: sourceQuote.shipToName ?? null,
                shipToCompany: sourceQuote.shipToCompany ?? null,
                shipToAddress1: sourceQuote.shipToAddress1 ?? null,
                shipToAddress2: sourceQuote.shipToAddress2 ?? null,
                shipToCity: sourceQuote.shipToCity ?? null,
                shipToState: sourceQuote.shipToState ?? null,
                shipToPostalCode: sourceQuote.shipToPostalCode ?? null,
                shipToCountry: sourceQuote.shipToCountry ?? null,
                shipToPhone: sourceQuote.shipToPhone ?? null,
                shipToEmail: sourceQuote.shipToEmail ?? null,
            };

            // Safest label behavior: clear it to avoid confusing "tags" carrying forward unintentionally.
            const createPayload: any = {
                customerId: payloadCustomerId,
                contactId: selectedContactId ?? sourceQuote.contactId ?? null,
                customerName: selectedCustomer?.companyName ?? sourceQuote.customerName ?? null,
                source: sourceQuote.source || "internal",
                shippingMethod: sourceQuote.shippingMethod ?? null,
                shippingMode: sourceQuote.shippingMode ?? null,
                carrier: sourceQuote.carrier ?? null,
                carrierAccountNumber: sourceQuote.carrierAccountNumber ?? null,
                shippingInstructions: sourceQuote.shippingInstructions ?? null,
                requestedDueDate: sourceQuote.requestedDueDate ?? null,
                validUntil: sourceQuote.validUntil ?? null,
                label: undefined,
                ...snapshotFields,
                lineItems: [firstLineItem],
                // Required by backend validations
                hasCustomerId: true,
                hasLineItems: true,
                // Totals are patched after all line items are copied to avoid partial totals.
                subtotal: 0,
                taxRate: 0,
                taxAmount: 0,
                totalPrice: 0,
            };

            const createResponse = await apiRequest("POST", "/api/quotes", createPayload);
            if (!createResponse.ok) {
                const errorBody = await createResponse.json().catch(() => ({}));
                throw new Error(errorBody?.message || "Failed to create duplicate quote");
            }

            const created = await createResponse.json();
            newQuoteId =
                created?.id ||
                created?.quote?.id ||
                created?.data?.id ||
                created?.data?.quote?.id ||
                created?.data?.data?.id;

            if (!newQuoteId) {
                throw new Error("Duplicate quote creation did not return an id");
            }

            createdCount = 1;

            // Copy remaining line items sequentially (failure-safe, with clear error handling)
            for (let i = 1; i < itemsToCopy.length; i++) {
                const li = itemsToCopy[i];
                try {
                    const resp = await apiRequest("POST", `/api/quotes/${newQuoteId}/line-items`, li);
                    if (!resp.ok) {
                        const body = await resp.json().catch(() => ({}));
                        throw new Error(body?.message || `Failed to copy line item ${i + 1}`);
                    }
                    createdCount++;
                } catch (err: any) {
                    // Stop on first failure so we can message partial duplication clearly.
                    throw new Error(err?.message || "Failed to copy line items");
                }
            }

            // Patch totals using existing quote update mechanism (no new APIs)
            const copiedSubtotal = itemsToCopy.reduce((sum, li) => sum + Number(li.linePrice || 0), 0);
            const copiedTaxAmount = copiedSubtotal * effectiveTaxRate;
            const copiedGrandTotal = copiedSubtotal + copiedTaxAmount;
            await apiRequest("PATCH", `/api/quotes/${newQuoteId}`, {
                subtotal: copiedSubtotal,
                taxRate: effectiveTaxRate,
                taxAmount: copiedTaxAmount,
                totalPrice: copiedGrandTotal,
                customerId: payloadCustomerId,
                contactId: createPayload.contactId,
                shippingMethod: createPayload.shippingMethod,
                shippingMode: createPayload.shippingMode,
                carrier: createPayload.carrier,
                carrierAccountNumber: createPayload.carrierAccountNumber,
                shippingInstructions: createPayload.shippingInstructions,
                label: createPayload.label,
            });

            toast({ title: "Duplicate created", description: "A new quote copy is ready." });
            navigate(ROUTES.quotes.edit(newQuoteId), { replace: false });
        } catch (err: any) {
            const message = err?.message || "Failed to duplicate quote";
            if (newQuoteId) {
                toast({
                    title: "Duplicate created with issues",
                    description: `${message}. The quote was created but line items may be partial (${createdCount}/${itemsToCopy.length}).`,
                    variant: "destructive",
                });
                navigate(ROUTES.quotes.edit(newQuoteId), { replace: false });
            } else {
                toast({
                    title: "Duplicate failed",
                    description: message,
                    variant: "destructive",
                });
            }
            console.error("[duplicateQuote] failed", { err, newQuoteId, createdCount });
        } finally {
            setIsDuplicatingQuote(false);
        }
    }, [
        quoteId,
        quote,
        lineItems,
        selectedCustomer,
        selectedCustomerId,
        selectedContactId,
        effectiveTaxRate,
        toast,
        navigate,
    ]);

    // ============================================================================
    // HANDLER: Convert to Order
    // ============================================================================

    const convertToOrder = useConvertQuoteToOrder(quoteId);

    const handleConvertToOrder = async (values: { dueDate: string; promisedDate: string; priority: string; notes: string }) => {
        if (!convertToOrder || !quoteId) return;
        await convertToOrder.mutateAsync({
            dueDate: values.dueDate || undefined,
            promisedDate: values.promisedDate || undefined,
            priority: values.priority || undefined,
            notesInternal: values.notes || undefined,
        });
    };

    // ============================================================================
    // HANDLER: Back navigation
    // ============================================================================

    const handleBack = () => {
        navigate(ROUTES.quotes.list);
    };

    // ============================================================================
    // HANDLER: Product selection (with draft creation)
    // ============================================================================

    const handleProductSelect = async (productId: string) => {
        setSelectedProductId(productId);
        setProductSearchOpen(false);
        setProductSearchQuery("");

        const product = products?.find(p => p.id === productId);
        if (!product) return;

        // Auto-create draft line item when a product is selected (only when quoteId exists)
        if (quoteId) {
            if (!draftLineItemId) {
                try {
                    setIsCreatingDraft(true);
                    const response = await apiRequest("POST", `/api/quotes/${quoteId}/line-items`, {
                        productId: product.id,
                        productName: product.name,
                        status: "draft",
                        productType: "wide_roll",
                        width: requiresDimensions ? parseFloat(width || "0") : 1,
                        height: requiresDimensions ? parseFloat(height || "0") : 1,
                        quantity: parseInt(quantity || "1", 10) || 1,
                        linePrice: 0,
                        priceBreakdown: {
                            basePrice: 0,
                            optionsPrice: 0,
                            total: 0,
                            formula: "",
                        },
                        displayOrder: lineItems.length,
                    });
                    const json = await response.json();
                    const created = json.data || json;
                    if (created?.id) {
                        setDraftLineItemId(created.id);
                    }
                } catch (err) {
                    console.error("Failed to create draft line item", err);
                } finally {
                    setIsCreatingDraft(false);
                }
            } else {
                // Update existing draft with new product
                patchDraftLineItem({
                    productId: product.id,
                    productName: product.name,
                    selectedOptions: [],
                });
                setOptionSelections({});
                setOptionSelectionsJson({ schemaVersion: 2, selected: {} });
            }
        }
    };

    // ============================================================================
    // HANDLER: Create a new draft line item immediately (for inline "Add Product" flow)
    // ============================================================================

    const createDraftLineItem = useCallback(
        async (productId: string): Promise<QuoteLineItemDraft | null> => {
            if (!products || !productId) return null;
            const product = products.find((p) => p.id === productId);
            if (!product) return null;

            // Default shape
            const base: QuoteLineItemDraft = {
                tempId: `temp-${Date.now()}`,
                id: undefined,
                productId: product.id,
                productName: product.name,
                variantId: null,
                variantName: null,
                productType: "wide_roll",
                width: 1,
                height: 1,
                quantity: 1,
                specsJson: {},
                optionSelectionsJson: null,
                selectedOptions: [],
                linePrice: 0,
                priceOverridden: false,
                overriddenPrice: null,
                formulaLinePrice: 0,
                priceBreakdown: { basePrice: 0, optionsPrice: 0, total: 0, formula: "" },
                displayOrder: lineItems.length,
                status: "draft",
                productOptions: (product.optionsJson as any[]) || [],
            };

            // If we have a saved quote, create server-side draft so artwork can be attached immediately.
            if (quoteId) {
                try {
                    setIsCreatingDraft(true);
                    const resp = await apiRequest("POST", `/api/quotes/${quoteId}/line-items`, {
                        productId: base.productId,
                        productName: base.productName,
                        variantId: base.variantId,
                        variantName: base.variantName,
                        productType: base.productType,
                        status: "draft",
                        width: base.width,
                        height: base.height,
                        quantity: base.quantity,
                        specsJson: base.specsJson,
                        optionSelectionsJson: (base as any).optionSelectionsJson,
                        selectedOptions: base.selectedOptions,
                        linePrice: base.linePrice,
                        priceBreakdown: base.priceBreakdown,
                        displayOrder: base.displayOrder,
                    });
                    const json = await resp.json().catch(() => ({}));
                    const created = json?.data || json;
                    const createdId = created?.id;
                    const withId: QuoteLineItemDraft = { ...base, id: createdId || undefined, tempId: base.tempId };
                    setLineItems((prev) => [...prev, withId]);
                    return withId;
                } catch (err) {
                    console.error("[createDraftLineItem] failed", err);
                    setLineItems((prev) => [...prev, base]);
                    return base;
                } finally {
                    setIsCreatingDraft(false);
                }
            }

            // New quote route: local-only draft.
            setLineItems((prev) => [...prev, base]);
            return base;
        },
        [products, quoteId, lineItems.length]
    );

    const updateLineItemLocal = useCallback((itemKey: string, updates: Partial<QuoteLineItemDraft>) => {
        if (!itemKey) return;
        setLineItems((prev) =>
            prev.map((li) => {
                const key = getStableLineItemKey(li);
                if (key !== itemKey) return li;
                return { ...li, ...updates };
            })
        );
    }, []);

    // Save a single line item to the server
    const saveLineItem = useCallback(async (itemKey: string): Promise<boolean> => {
        if (!quoteId || !itemKey) return false;

        const item = lineItems.find((li) => getStableLineItemKey(li) === itemKey);
        if (!item || !item.productId) return false;

        try {
            const payload: any = {
                productId: item.productId,
                productName: item.productName,
                variantId: item.variantId ?? null,
                variantName: item.variantName ?? null,
                productType: item.productType || "wide_roll",
                width: item.width,
                height: item.height,
                quantity: item.quantity,
                specsJson: item.specsJson || {},
                optionSelectionsJson: (item as any).optionSelectionsJson ?? null,
                selectedOptions: item.selectedOptions || [],
                linePrice: item.linePrice ?? 0,
                priceBreakdown: item.priceBreakdown || {
                    basePrice: item.linePrice ?? 0,
                    optionsPrice: 0,
                    total: item.linePrice ?? 0,
                    formula: "",
                },
                displayOrder: item.displayOrder ?? 0,
                status: item.status === "canceled" ? "canceled" : "active",
            };

            if (item.id) {
                // Update existing line item
                await apiRequest("PATCH", `/api/quotes/${quoteId}/line-items/${item.id}`, payload);
                // Update local state to mark as saved
                setLineItems((prev) =>
                    prev.map((li) => {
                        if (getStableLineItemKey(li) === itemKey) {
                            return { ...li, status: "active" as const };
                        }
                        return li;
                    })
                );
            } else {
                // Create new line item
                const response = await apiRequest("POST", `/api/quotes/${quoteId}/line-items`, payload);
                const json = await response.json();
                const created = json?.data || json;
                const createdId = created?.id;
                if (createdId) {
                    setLineItems((prev) =>
                        prev.map((li) => {
                            if (getStableLineItemKey(li) === itemKey) {
                                return { ...li, id: createdId, status: "active" as const };
                            }
                            return li;
                        })
                    );
                }
            }

            toast({
                title: "Line item saved",
                description: "Changes have been saved.",
            });
            return true;
        } catch (error: any) {
            toast({
                title: "Failed to save line item",
                description: error?.message || "Please try again.",
                variant: "destructive",
            });
            return false;
        }
    }, [quoteId, lineItems, toast]);

    /**
     * Ensure a line item has a persisted ID (explicit intent on upload).
     * If the line item is TEMP (no id), persist it to get a real lineItemId.
     * If quoteId is missing, create quote WITH this line item atomically.
     * Returns both quoteId and lineItemId for use in attach requests.
     * 
     * CRITICAL: This function must NOT update savedSnapshotRef or trigger full save behavior.
     * It only creates the minimal persistence needed for attachments.
     */
    const ensureLineItemId = useCallback(
        async (itemKey: string): Promise<{ quoteId: string; lineItemId: string }> => {
            const item = lineItems.find((li) => getStableLineItemKey(li) === itemKey);
            if (!item) {
                throw new Error("Line item not found");
            }

            // If already persisted, return existing ids
            if (item.id && quoteId) {
                return { quoteId, lineItemId: item.id };
            }

            // CASE 1: Quote exists but line item needs persistence
            if (quoteId && !item.id) {
                // Now persist the line item to existing quote
                const payload: any = {
                    productId: item.productId,
                    productName: item.productName,
                    variantId: item.variantId ?? null,
                    variantName: item.variantName ?? null,
                    productType: item.productType || "wide_roll",
                    width: item.width,
                    height: item.height,
                    quantity: item.quantity,
                    specsJson: item.specsJson || {},
                    optionSelectionsJson: (item as any).optionSelectionsJson ?? null,
                    selectedOptions: item.selectedOptions || [],
                    linePrice: item.linePrice ?? 0,
                    priceBreakdown: item.priceBreakdown || {
                        basePrice: item.linePrice ?? 0,
                        optionsPrice: 0,
                        total: item.linePrice ?? 0,
                        formula: "",
                    },
                    displayOrder: item.displayOrder ?? 0,
                    status: "active",
                };

                const response = await apiRequest("POST", `/api/quotes/${quoteId}/line-items`, payload);
                const json = await response.json();
                const created = json?.data || json;
                const createdId = created?.id;

                if (!createdId) {
                    throw new Error("Failed to create line item");
                }

                // Update local state with the new id (preserve all draft fields)
                setLineItems((prev) =>
                    prev.map((li) => {
                        if (getStableLineItemKey(li) === itemKey) {
                            return { ...li, id: createdId };
                        }
                        return li;
                    })
                );

                return { quoteId, lineItemId: createdId };
            }

            // CASE 2: No quote exists AND line item has no id
            // Create quote WITH this line item atomically to satisfy backend validation
            if (!quoteId && !item.id) {
                const payloadCustomerId = selectedCustomer?.id ?? selectedCustomerId ?? (quote as any)?.customerId ?? null;

                // Build line item payload
                const lineItemPayload = {
                    productId: item.productId,
                    productName: item.productName,
                    variantId: item.variantId ?? null,
                    variantName: item.variantName ?? null,
                    productType: item.productType || "wide_roll",
                    width: item.width,
                    height: item.height,
                    quantity: item.quantity,
                    specsJson: item.specsJson || {},
                    optionSelectionsJson: (item as any).optionSelectionsJson ?? null,
                    selectedOptions: item.selectedOptions || [],
                    linePrice: item.linePrice ?? 0,
                    priceBreakdown: item.priceBreakdown || {
                        basePrice: item.linePrice ?? 0,
                        optionsPrice: 0,
                        total: item.linePrice ?? 0,
                        formula: "",
                    },
                    displayOrder: item.displayOrder ?? 0,
                    status: "active",
                };

                // Create quote with this line item included
                const quoteWithLineItem = {
                    customerId: payloadCustomerId,
                    contactId: selectedContactId ?? null,
                    customerName: selectedCustomer?.companyName ?? (quote as any)?.customerName ?? null,
                    lineItems: [lineItemPayload], // Include the line item!
                    subtotal,
                    taxRate: effectiveTaxRate,
                    taxAmount,
                    discountAmount: effectiveDiscount,
                    totalPrice: grandTotal,
                    label: jobLabel || null,
                    requestedDueDate: requestedDueDate ? new Date(`${requestedDueDate}T00:00:00.000Z`).toISOString() : null,
                    shippingMethod: deliveryMethod,
                    shippingInstructions: quoteNotes || null,
                    source: "internal",
                    hasCustomerId: !!payloadCustomerId,
                    hasLineItems: true, // We're including a line item
                    tags: tags,
                    quoteTaxExempt: quoteTaxExempt ?? undefined,
                    quoteTaxRateOverride: quoteTaxRateOverride ?? undefined,
                };

                const error = validateQuote(quoteWithLineItem);
                if (error) {
                    throw new Error(error);
                }

                const response = await apiRequest("POST", "/api/quotes", quoteWithLineItem);
                if (!response.ok) {
                    const errorBody = await response.json().catch(() => ({}));
                    throw new Error(errorBody?.message || "Failed to create quote");
                }
                const created = await response.json();
                const newQuoteId = created?.id || created?.quote?.id || created?.data?.id || created?.data?.quote?.id;
                
                if (!newQuoteId) {
                    throw new Error("Quote creation did not return an id");
                }

                // Extract the created line item ID from the response
                const createdLineItems = created?.finalizedLineItems || created?.quote?.lineItems || created?.data?.lineItems || [];
                const createdLineItem = createdLineItems[0];
                const newLineItemId = createdLineItem?.id;

                if (!newLineItemId) {
                    throw new Error("Quote created but line item ID not returned");
                }

                // Update local state: patch the line item with its new id (preserve tempId and draft fields)
                setLineItems((prev) =>
                    prev.map((li) => {
                        if (getStableLineItemKey(li) === itemKey) {
                            return { ...li, id: newLineItemId };
                        }
                        return li;
                    })
                );

                // Invalidate quote list but do NOT update snapshot (keeps dirty tracking active)
                queryClientInstance.invalidateQueries({ queryKey: ["/api/quotes"] });
                
                // Adopt this quote as canonical immediately to prevent duplicate creation
                setImperativeQuoteId(newQuoteId);

                return { quoteId: newQuoteId, lineItemId: newLineItemId };
            }

            // CASE 3: Quote just created, line item already has id
            if (item.id) {
                return { quoteId: quoteId!, lineItemId: item.id };
            }

            throw new Error("Unexpected state in ensureLineItemId");
        },
        [
            lineItems,
            quoteId,
            selectedCustomer,
            selectedCustomerId,
            quote,
            selectedContactId,
            subtotal,
            effectiveTaxRate,
            taxAmount,
            effectiveDiscount,
            grandTotal,
            jobLabel,
            requestedDueDate,
            deliveryMethod,
            quoteNotes,
            tags,
            quoteTaxExempt,
            quoteTaxRateOverride,
            validateQuote,
        ]
    );

    /**
     * Persist reordered line items by updating displayOrder via PATCH endpoint.
     * Only updates items whose displayOrder has actually changed.
     * Fail-soft: if any PATCH fails, refetch quote and return ok: false.
     */
    const reorderLineItemsByKeys = useCallback(
        async (orderedKeys: string[]): Promise<{ ok: boolean }> => {
            if (!quoteId) {
                // No persisted quote yet - fail soft
                return { ok: true };
            }

            try {
                // Map keys to line items
                const orderedItems = orderedKeys
                    .map(key => lineItems.find(li => getStableLineItemKey(li) === key))
                    .filter((li): li is QuoteLineItemDraft => !!li && !!li.id); // Only persist items with real IDs

                if (orderedItems.length === 0) {
                    return { ok: true };
                }

                // Build list of updates (only for items where displayOrder changed)
                const updates: Array<{ id: string; newDisplayOrder: number }> = [];
                orderedItems.forEach((item, index) => {
                    const newDisplayOrder = index;
                    if (item.displayOrder !== newDisplayOrder) {
                        updates.push({ id: item.id!, newDisplayOrder });
                    }
                });

                if (updates.length === 0) {
                    return { ok: true };
                }

                // Persist updates sequentially (simplest and safest)
                for (const { id, newDisplayOrder } of updates) {
                    await apiRequest("PATCH", `/api/quotes/${quoteId}/line-items/${id}`, {
                        displayOrder: newDisplayOrder,
                    });
                }

                // Invalidate and refetch quote to sync server state
                await queryClientInstance.invalidateQueries({ queryKey: ["/api/quotes", quoteId] });
                
                return { ok: true };
            } catch (error) {
                console.error("[reorderLineItemsByKeys] failed:", error);
                
                // Refetch to restore consistency
                queryClientInstance.invalidateQueries({ queryKey: ["/api/quotes", quoteId] });
                
                toast({
                    title: "Failed to save order",
                    description: "Line item order could not be saved. Changes have been reverted.",
                    variant: "destructive",
                });
                
                return { ok: false };
            }
        },
        [quoteId, lineItems, queryClientInstance, toast]
    );

    const discardAllChanges = useCallback(async () => {
        const snap = savedSnapshotRef.current;
        if (!snap) return;

        // Delete any newly created line items on the server (best effort) for existing quotes.
        if (quoteId) {
            const prevIds = new Set((snap.lineItems || []).map((li) => li.id).filter(Boolean) as string[]);
            const currentNewIds = (lineItems || [])
                .map((li) => li.id)
                .filter((id): id is string => !!id && !prevIds.has(id));

            await Promise.all(
                currentNewIds.map((id) =>
                    apiRequest("DELETE", `/api/quotes/${quoteId}/line-items/${id}`).catch((err) => {
                        console.error("[discardAllChanges] failed deleting new line item", { id, err });
                    })
                )
            );
        }

        // Reset local state
        setSelectedCustomerId(snap.selectedCustomerId);
        setSelectedCustomer(snap.selectedCustomer);
        setSelectedContactId(snap.selectedContactId);
        setDeliveryMethod(snap.deliveryMethod);
        setShippingCents(snap.shippingCents);
        setUseCustomerAddress(snap.useCustomerAddress);
        setShippingAddress(snap.shippingAddress);
        setQuoteNotes(snap.quoteNotes);
        setJobLabel(snap.jobLabel);
        setRequestedDueDate(snap.requestedDueDate);
        setDiscountAmount(snap.discountAmount);
        setTags(snap.tags);
        setQuoteTaxExempt(snap.quoteTaxExempt);
        setQuoteTaxRateOverride(snap.quoteTaxRateOverride);
        setLineItems(snap.lineItems.map((li) => ({ ...li })));
    }, [quoteId, lineItems]);

    // ============================================================================
    // SORTED LINE ITEMS (displayOrder → id tiebreaker)
    // ============================================================================

    // Always render line items in displayOrder, with id as stable tiebreaker
    const sortedLineItems = useMemo(() => {
        return [...lineItems].sort((a, b) => {
            // Primary: sort by displayOrder ascending
            const orderA = a.displayOrder ?? 0;
            const orderB = b.displayOrder ?? 0;
            if (orderA !== orderB) {
                return orderA - orderB;
            }
            // Tiebreaker: stable sort by id (tempId || id)
            const idA = a.tempId || a.id || "";
            const idB = b.tempId || b.id || "";
            return idA.localeCompare(idB);
        });
    }, [lineItems]);

    // ============================================================================
    // RETURN: Hook interface
    // ============================================================================

    return {
        // Route & loading state
        quoteId,
        isNewQuote,
        isInitialQuoteLoading,
        isQuoteRefreshing,
        isInternalUser,

        // Data
        quote,
        products: products || [],
        organization,

        // Customer
        selectedCustomer,
        selectedCustomerId,
        selectedContactId,
        contacts,
        pricingTier,
        discountPercent,
        markupPercent,
        marginPercent,
        customerHasAddress,

        // Fulfillment
        deliveryMethod,
        shippingCents,
        shippingAddress,
        quoteNotes,
        useCustomerAddress,

        // Quote meta
        jobLabel,
        requestedDueDate,
        discountAmount,
        tags,
        quoteTaxExempt,
        quoteTaxRateOverride,

        // Line items (sorted by displayOrder)
        lineItems: sortedLineItems,
        draftLineItemId,
        isCreatingDraft,

        // Product builder state
        selectedProductId,
        selectedProduct,
        selectedVariantId,
        productVariants: productVariants || [],
        width,
        height,
        quantity,
        calculatedPrice,
        isCalculating,
        calcError,
        optionSelections,
        optionSelectionsJson,
        lineItemNotes,
        requiresDimensions,
        productOptions,
        hasAttachmentOption,

        // Product search
        productSearchOpen,
        productSearchQuery,
        filteredProducts,

        // Computed values
        subtotal,
        taxAmount,
        grandTotal,
        effectiveTaxRate,
        canSaveQuote,
        canConvertToOrder,
        isSaving,
        isDuplicatingQuote,
        canDuplicateQuote,
        hasUnsavedChanges,

        // Pricing status
        pricingStale,
        isRepricingLineItems,

        // Handlers
        handlers: {
            // Customer
            setCustomer: (customerId: string | null, customer?: CustomerWithContacts | undefined, contactId?: string | null | undefined) => {
                setSelectedCustomerId(customerId);
                setSelectedCustomer(customer);
                setSelectedContactId(contactId || null);
                void repriceExistingLineItemsForCustomer(customerId);
                // Pre-fill shipping address from customer if ship is selected
                if (customer && deliveryMethod === 'ship') {
                    setShippingAddress({
                        street1: customer.shippingStreet1 || '',
                        street2: customer.shippingStreet2 || '',
                        city: customer.shippingCity || '',
                        state: customer.shippingState || '',
                        postalCode: customer.shippingPostalCode || '',
                        country: customer.shippingCountry || 'USA'
                    });
                }
            },
            setContactId: setSelectedContactId,

            // Fulfillment
            setDeliveryMethod,
            setShippingCents,
            updateShippingAddress: (updates: Partial<Address>) => {
                setUseCustomerAddress(false);
                setShippingAddress(prev => ({ ...prev, ...updates }));
            },
            setQuoteNotes,
            handleCopyCustomerAddress,
            setJobLabel,
            setRequestedDueDate,
            setDiscountAmount,
            addTag: (tag: string) => {
                const trimmed = tag.trim();
                if (!trimmed) return; // Ignore empty tags
                
                // Check for duplicates case-insensitively
                const lowerTrimmed = trimmed.toLowerCase();
                const isDuplicate = tags.some(t => t.toLowerCase() === lowerTrimmed);
                
                if (!isDuplicate) {
                    setTags([...tags, trimmed]);
                }
            },
            removeTag: (tag: string) => {
                setTags(tags.filter(t => t !== tag));
            },
            setQuoteTaxExempt,
            setQuoteTaxRateOverride,

            // Product builder
            setSelectedProductId: handleProductSelect,
            setSelectedVariantId,
            setWidth: (w: string) => {
                setWidth(w);
                if (draftLineItemId && quoteId) {
                    const widthVal = requiresDimensions ? parseFloat(w || "0") : 1;
                    patchDraftLineItem({ width: widthVal });
                }
            },
            setHeight: (h: string) => {
                setHeight(h);
                if (draftLineItemId && quoteId) {
                    const heightVal = requiresDimensions ? parseFloat(h || "0") : 1;
                    patchDraftLineItem({ height: heightVal });
                }
            },
            setQuantity: (q: string) => {
                setQuantity(q);
                if (draftLineItemId && quoteId) {
                    const quantityVal = parseInt(q || "1", 10) || 1;
                    patchDraftLineItem({ quantity: quantityVal });
                }
            },
            setOptionSelections,
            setOptionSelectionsJson,
            setLineItemNotes,
            setProductSearchOpen,
            setProductSearchQuery,

            // Line item operations
            addLineItem: handleAddLineItem,
            duplicateLineItem: handleDuplicateLineItem,
            removeLineItem: handleRemoveLineItem,
            editLineItem: (id: string) => {
                setDraftLineItemId(id);
            },
            setLineItemPriceOverride,
            createDraftLineItem,
            updateLineItemLocal,
            saveLineItem,
            ensureLineItemId,
            reorderLineItemsByKeys,
            discardAllChanges,

            // Quote operations
            saveQuote: handleSaveQuote,
            duplicateQuote,
            convertToOrder: handleConvertToOrder,
            handleBack,
        },

        // Convert to order hook
        convertToOrderHook: convertToOrder,
    };
}
