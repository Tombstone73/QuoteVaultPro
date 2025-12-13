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

    // Canonical quoteId for querying (null on /quotes/new)
    const quoteId: string | null = isNewQuoteRoute ? null : routeQuoteId;
    const isNewQuote = !quoteId;

    const isInternalUser = user && ['admin', 'owner', 'manager', 'employee'].includes(user.role || '');

    // ============================================================================
    // CUSTOMER STATE
    // ============================================================================

    const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
    const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
    const [selectedCustomer, setSelectedCustomer] = useState<CustomerWithContacts | undefined>(undefined);

    // ============================================================================
    // FULFILLMENT STATE
    // ============================================================================

    const [deliveryMethod, setDeliveryMethod] = useState<'pickup' | 'ship' | 'deliver'>('pickup');
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
    const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

    // ============================================================================
    // OPTION SELECTION STATE
    // ============================================================================

    const [optionSelections, setOptionSelections] = useState<Record<string, OptionSelection>>({});
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
        return (selectedProduct?.optionsJson as ProductOptionItem[] | undefined) || [];
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
        if (!productSearchQuery) return activeProducts;
        const query = productSearchQuery.toLowerCase();
        return activeProducts.filter(p =>
            p.name.toLowerCase().includes(query) ||
            ((p as any).sku && (p as any).sku.toLowerCase().includes(query))
        );
    }, [products, productSearchQuery]);

    // ============================================================================
    // COMPUTED VALUES: Contacts
    // ============================================================================

    const contacts = selectedCustomer?.contacts || [];

    // ============================================================================
    // COMPUTED VALUES: Pricing
    // ============================================================================

    const activeLineItems = lineItems.filter((li) => li.status !== "draft");
    const subtotal = activeLineItems.reduce((sum, item) => sum + item.linePrice, 0);

    const effectiveTaxRate = selectedCustomer?.isTaxExempt
        ? 0
        : selectedCustomer?.taxRateOverride != null
            ? Number(selectedCustomer.taxRateOverride)
            : Number(organization?.defaultTaxRate || 0);

    const taxAmount = subtotal * effectiveTaxRate;
    const grandTotal = subtotal + taxAmount;

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
        if (quote) {
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
        }
    }, [quote, selectedCustomerId, selectedContactId, selectedCustomer]);

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
        const productOptionsForSync = (selectedProduct.optionsJson as ProductOptionItem[] | undefined) || [];
        const selectedOptionsArray: Array<{
            optionId: string;
            optionName: string;
            value: string | number | boolean;
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
                setupCost,
                calculatedCost,
            });
        });

        patchDraftLineItem({ selectedOptions: selectedOptionsArray });
    }, [draftLineItemId, quoteId, optionSelections, selectedProduct, requiresDimensions, width, height, quantity, patchDraftLineItem]);

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

        setIsCalculating(true);
        setCalcError(null);

        try {
            const response = await apiRequest("POST", "/api/quotes/calculate", {
                productId: selectedProductId,
                variantId: selectedVariantId,
                width: widthNum,
                height: heightNum,
                quantity: quantityNum,
                selectedOptions: buildSelectedOptionsPayload(),
            });
            const data = await response.json();
            setCalculatedPrice(data.price);
        } catch (error) {
            setCalcError(error instanceof Error ? error.message : "Calculation failed");
            setCalculatedPrice(null);
        } finally {
            setIsCalculating(false);
        }
    }, [selectedProductId, selectedVariantId, width, height, quantity, requiresDimensions, buildSelectedOptionsPayload]);

    // ============================================================================
    // EFFECT: Debounced auto-calculation
    // ============================================================================

    useEffect(() => {
        // Clear existing timer
        if (debounceTimerRef.current) {
            clearTimeout(debounceTimerRef.current);
        }

        // Set new timer for 500ms debounce
        debounceTimerRef.current = setTimeout(() => {
            triggerAutoCalculate();
        }, 500);

        // Cleanup
        return () => {
            if (debounceTimerRef.current) {
                clearTimeout(debounceTimerRef.current);
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
                setupCost,
                calculatedCost,
            });
        });

        const linePrice = calculatedPrice ?? 0;

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
            totalPrice: grandTotal,
            source: "internal",
            hasCustomerId: payloadHasCustomerId,
            hasLineItems: payloadHasLineItems,
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
            totalPrice: grandTotal,
            source: "internal",
            hasCustomerId: payloadHasCustomerId,
            hasLineItems: payloadHasLineItems,
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

                // Return result instead of navigating
                return { kind: "created", quoteId: newId, quoteNumber: newQuoteNumber };
            } else {
                const payload = buildQuotePayload();
                await saveQuoteMutation.mutateAsync(payload);
                toast({
                    title: "Quote saved",
                    description: "Your changes to this quote have been saved.",
                });
                queryClientInstance.invalidateQueries({ queryKey: ["/api/quotes"] });
                queryClientInstance.invalidateQueries({ queryKey: ["/api/quotes", quoteId] });

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
            }
        }
    };

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
        shippingAddress,
        quoteNotes,
        useCustomerAddress,

        // Line items
        lineItems,
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

        // Handlers
        handlers: {
            // Customer
            setCustomer: (customerId: string | null, customer?: CustomerWithContacts | undefined, contactId?: string | null | undefined) => {
                setSelectedCustomerId(customerId);
                setSelectedCustomer(customer);
                setSelectedContactId(contactId || null);
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
            updateShippingAddress: (updates: Partial<Address>) => {
                setUseCustomerAddress(false);
                setShippingAddress(prev => ({ ...prev, ...updates }));
            },
            setQuoteNotes,
            handleCopyCustomerAddress,

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
