import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { ROUTES } from "@/config/routes";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { 
  ArrowLeft, Save, Plus, Trash2, Loader2, Copy, Pencil, 
  Truck, Store, Building2, DollarSign, Users, FileText, Shield, Send,
  ChevronDown, Check, ChevronsUpDown, ListOrdered, Paperclip
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { CustomerSelect, type CustomerWithContacts } from "@/components/CustomerSelect";
import type { Product, ProductVariant, QuoteWithRelations, ProductOptionItem, Organization } from "@shared/schema";
import { profileRequiresDimensions, getProfile } from "@shared/pricingProfiles";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { LineItemAttachmentsPanel, LineItemArtworkBadge } from "@/components/LineItemAttachmentsPanel";

// Note: QuoteAttachment type removed - artwork is now handled per line item via LineItemAttachmentsPanel

/**
 * Helper function to format option price label based on priceMode
 */
function formatOptionPriceLabel(option: ProductOptionItem): string {
  const amount = option.amount || 0;
  
  switch (option.priceMode) {
    case "percent_of_base":
      // Show as percentage
      return `+${amount}%`;
    case "flat_per_item":
      // Show as per-item price
      return `+$${amount.toFixed(2)} ea`;
    case "per_sqft":
      // Show as per-sqft price
      return `+$${amount.toFixed(2)}/sqft`;
    case "per_qty":
      // Show as per-quantity price
      return `+$${amount.toFixed(2)}/qty`;
    case "flat":
    default:
      // Show as flat amount
      return `+$${amount.toFixed(2)}`;
  }
}

type QuoteLineItemDraft = {
  tempId?: string;
  id?: string;
  productId: string;
  productName: string;
  variantId: string | null;
  variantName: string | null;
  productType: string;
  width: number;
  height: number;
  quantity: number;
  specsJson: Record<string, any>;
  selectedOptions: any[];
  linePrice: number;
  priceBreakdown: any;
  displayOrder: number;
  notes?: string;
  productOptions?: ProductOptionItem[];
  status?: "draft" | "active" | "canceled";
};

export default function QuoteEditor() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [matchEdit, paramsEdit] = useRoute("/quotes/:id/edit");
  const [matchDetail, paramsDetail] = useRoute("/quotes/:id");
  const [, navigate] = useLocation();
  
  const quoteId: string | null = paramsEdit?.id || paramsDetail?.id || null;

  const isInternalUser = user && ['admin', 'owner', 'manager', 'employee'].includes(user.role || '');

  // Customer selection
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerWithContacts | undefined>(undefined);

  // Logistics / Fulfillment
  const [deliveryMethod, setDeliveryMethod] = useState<'pickup' | 'ship' | 'deliver'>('pickup');
  const [useCustomerAddress, setUseCustomerAddress] = useState(false);
  const [shippingAddress, setShippingAddress] = useState({
    street1: '',
    street2: '',
    city: '',
    state: '',
    postalCode: '',
    country: 'USA'
  });
  const [quoteNotes, setQuoteNotes] = useState('');

  // Product search for combobox
  const [productSearchOpen, setProductSearchOpen] = useState(false);
  const [productSearchQuery, setProductSearchQuery] = useState("");

  // Note: Per-line-item artwork is now managed via LineItemAttachmentsPanel.
  // Old quote-level file upload state has been removed.

  // Line item being added
  const [lineItems, setLineItems] = useState<QuoteLineItemDraft[]>([]);
  const [editingLineItemId, setEditingLineItemId] = useState<string | null>(null);
  const [selectedProductId, setSelectedProductId] = useState("");
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);
  const [width, setWidth] = useState("");
  const [height, setHeight] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [calculatedPrice, setCalculatedPrice] = useState<number | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);
  const [calcError, setCalcError] = useState<string | null>(null);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [draftLineItemId, setDraftLineItemId] = useState<string | null>(null);
  const [isCreatingDraft, setIsCreatingDraft] = useState(false);

  // Option selection state
  const [optionSelections, setOptionSelections] = useState<Record<string, {
    value: string | number | boolean;
    grommetsLocation?: string;
    grommetsSpacingCount?: number;
    grommetsPerSign?: number;
    grommetsSpacingInches?: number;
    customPlacementNote?: string;
    hemsType?: string;
    polePocket?: string;
  }>>({});

  // Line item notes
  const [lineItemNotes, setLineItemNotes] = useState<string>("");
  const [attachmentsItem, setAttachmentsItem] = useState<QuoteLineItemDraft | null>(null);
  const [attachmentsOpen, setAttachmentsOpen] = useState(false);

  const { data: products } = useQuery<Product[]>({
    queryKey: ["/api/products"],
  });

  // Canonical product reference used by all effects and pricing logic.
  // This is the single source of truth for the currently selected product.
  const selectedProduct = useMemo(() =>
    products?.find((p) => p.id === selectedProductId) ?? null,
    [products, selectedProductId]
  );

  // A product "requires dimensions" if either:
  // - the backend explicitly flags it (future-proof),
  // - OR its pricingMode is "area" (area-based pricing uses width/height).
  // Fee/addon products NEVER require dimensions.
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


  // Filter products for combobox search
  const filteredProducts = useMemo(() => {
    if (!products) return [];
    const activeProducts = products.filter(p => p.isActive);
    if (!productSearchQuery) return activeProducts;
    const query = productSearchQuery.toLowerCase();
    return activeProducts.filter(p => 
      p.name.toLowerCase().includes(query) ||
      (p.sku && p.sku.toLowerCase().includes(query))
    );
  }, [products, productSearchQuery]);

  // Helper to build selectedOptions payload from optionSelections state
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

  // Query client for invalidation
  const queryClientInstance = useQueryClient();

  // Load organization for tax rate defaults
  const { data: organization } = useQuery<Organization>({
    queryKey: ["/api/organization/current"],
    queryFn: async () => {
      const response = await fetch("/api/organization/current", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch organization");
      return response.json();
    },
  });

  // Load existing quote if editing
  const { data: quote, isLoading: quoteLoading } = useQuery<QuoteWithRelations>({
    queryKey: ["/api/quotes", quoteId],
    queryFn: async () => {
      if (!quoteId) throw new Error("Quote ID is required");
      const response = await fetch(`/api/quotes/${quoteId}`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to load quote");
      return response.json();
    },
    enabled: !!quoteId,
  });

  // Note: Quote-level file query removed. Artwork is now attached to individual line items.

  // Load data when editing existing quote
  useEffect(() => {
    if (quote) {
      // Sync customer ID and contact ID
      if (quote.customerId && !selectedCustomerId) {
        setSelectedCustomerId(quote.customerId);
      }
      if (quote.contactId && !selectedContactId) {
        setSelectedContactId(quote.contactId);
      }

      // If quote includes customer data, populate selectedCustomer
      if ((quote as any).customer && !selectedCustomer) {
        setSelectedCustomer((quote as any).customer as CustomerWithContacts);
      }

      setLineItems(quote.lineItems?.map((item, idx) => ({
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
        priceBreakdown: item.priceBreakdown,
        displayOrder: idx,
        notes: (item.specsJson as any)?.notes || undefined,
        productOptions: (item as any).productOptions || (item as any).product?.optionsJson || [],
      })) || []);
    }
  }, [quote, selectedCustomerId, selectedContactId, selectedCustomer]);

  const { data: productVariants } = useQuery<ProductVariant[]>({
    queryKey: ["/api/products", selectedProductId, "variants"],
    enabled: !!selectedProductId,
  });

  const productOptions = useMemo(() => {
    return (selectedProduct?.optionsJson as ProductOptionItem[] | undefined) || [];
  }, [selectedProduct]);

  const hasAttachmentOption = useMemo(
    () => productOptions.some((opt) => opt.type === "attachment"),
    [productOptions]
  );
  
  // Debug: Log product options when product changes
  useEffect(() => {
    if (selectedProduct) {
      console.log('[QuoteEditor] Selected product:', selectedProduct.name);
      console.log('[QuoteEditor] Product optionsJson:', selectedProduct.optionsJson);
      console.log('[QuoteEditor] Options length:', (selectedProduct.optionsJson as ProductOptionItem[])?.length || 0);
    }
  }, [selectedProduct]);
  
  // retains legacy/default behavior when no product is selected

  // Get contacts from selected customer
  const contacts = selectedCustomer?.contacts || [];

  // Fetch customer details with contacts when editing
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

  // Update selectedCustomer when customerData is fetched
  useEffect(() => {
    if (customerData && !selectedCustomer) {
      setSelectedCustomer(customerData);
    }
  }, [customerData, selectedCustomer]);

  // Populate form fields when editing a line item
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

  // Auto-calculate price with debounce
  const triggerAutoCalculate = useCallback(async () => {
    // Check if all required fields are present and valid
    // For products that don't require dimensions, only check quantity
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

  // Debounced auto-calculation effect
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

  const calculateMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/quotes/calculate", {
        productId: selectedProductId,
        variantId: selectedVariantId,
        width: requiresDimensions ? parseFloat(width) : 1,
        height: requiresDimensions ? parseFloat(height) : 1,
        quantity: parseInt(quantity),
        selectedOptions: buildSelectedOptionsPayload(),
      });
      return await response.json();
    },
    onSuccess: (data: any) => {
      setCalculatedPrice(data.price);
    },
    onError: (error: Error) => {
      toast({
        title: "Calculation Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const saveQuoteMutation = useMutation({
    mutationFn: async () => {
      const quoteData: any = {
        customerId: selectedCustomerId || null,
        contactId: selectedContactId || undefined,
        customerName: selectedCustomer?.companyName || undefined,
        source: 'internal',
      };

      if (quote?.status === "draft") {
        quoteData.status = "active";
      }

      const response = await apiRequest("PATCH", `/api/quotes/${quoteId}`, quoteData);
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

  const deleteQuoteMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/quotes/${quoteId}`);
    },
    onSuccess: () => {
      toast({ title: "Draft discarded" });
      queryClient.invalidateQueries({ queryKey: ["/api/quotes"] });
      navigate(ROUTES.quotes.list);
    },
    onError: (error: Error) => {
      toast({
        title: "Error discarding draft",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleDiscardDraft = () => {
    if (!quote || quote.status !== "draft") return;
    const confirmed = window.confirm("Discard this draft quote? This will remove the quote and its draft line items/attachments.");
    if (!confirmed) return;
    deleteQuoteMutation.mutate();
  };

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

  // Sync selected options to draft line item when they change
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

  const handleAddLineItem = async () => {
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

  const handleRemoveLineItem = (tempId: string) => {
    setLineItems(lineItems.filter(item => item.tempId !== tempId && item.id !== tempId));
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

  // Copy customer address to shipping address
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

  // Check if customer has any address on file
  const customerHasAddress = selectedCustomer && (
    selectedCustomer.shippingStreet1 || selectedCustomer.billingStreet1 ||
    selectedCustomer.shippingCity || selectedCustomer.billingCity
  );

  // Note: Quote-level file upload handlers removed.
  // Artwork is now attached to individual line items via LineItemAttachmentsPanel.

  if (!isInternalUser) {
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

  // Show loading skeleton while quote loads or if no quoteId (redirect in progress)
  if (quoteLoading || !quoteId) {
    return (
      <div className="container mx-auto p-6 space-y-4">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  // Calculate pricing summary
  const subtotal = lineItems
    .filter((li) => li.status !== "draft")
    .reduce((sum, item) => sum + item.linePrice, 0);
  
  // Get effective tax rate - customer override > org default
  const effectiveTaxRate = selectedCustomer?.isTaxExempt 
    ? 0 
    : selectedCustomer?.taxRateOverride != null 
      ? Number(selectedCustomer.taxRateOverride)
      : Number(organization?.defaultTaxRate || 0);
  
  const taxAmount = subtotal * effectiveTaxRate;
  const grandTotal = subtotal + taxAmount;

  // Customer info computed values
  const pricingTier = selectedCustomer?.pricingTier || 'default';
  const discountPercent = selectedCustomer?.defaultDiscountPercent ? Number(selectedCustomer.defaultDiscountPercent) : null;
  const markupPercent = selectedCustomer?.defaultMarkupPercent ? Number(selectedCustomer.defaultMarkupPercent) : null;
  const marginPercent = selectedCustomer?.defaultMarginPercent ? Number(selectedCustomer.defaultMarginPercent) : null;

  return (
    <div className="max-w-7xl mx-auto space-y-3 px-4">
      {/* Header with navigation and actions */}
      <div className="flex items-center justify-between py-2">
        <Button variant="ghost" onClick={() => navigate(ROUTES.quotes.list)} className="gap-2 h-9">
          <ArrowLeft className="w-4 h-4" />
          Back to Quotes
        </Button>
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold">
            {quote ? `Quote #${quote.quoteNumber || ""}` : "Quote"}
          </h1>
          {quote?.status === "draft" && (
            <Badge variant="outline" className="text-xs">
              Draft
            </Badge>
          )}
        </div>
        <div className="w-32" /> {/* Spacer for centering */}
      </div>

      {/* 3-Column Cockpit Layout */}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(280px,340px)_minmax(0,1fr)_minmax(280px,340px)]">
        
        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* LEFT COLUMN: Customer & Logistics */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        <div className="space-y-3 order-1 xl:order-1">
          {/* Customer Card */}
          <Card className="rounded-xl bg-card/80 border-border/60 shadow-md">
            <CardHeader className="pb-2 px-5 pt-4">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Users className="w-4 h-4" />
                Customer
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 px-5 pb-4">
              <div className="space-y-1.5">
                <CustomerSelect
                  value={selectedCustomerId}
                  onChange={(customerId, customer, contactId) => {
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
                  }}
                  autoFocus={false}
                  label=""
                  placeholder="Search customers..."
                />
                {selectedCustomer && (
                  <div className="text-xs text-muted-foreground space-y-0.5">
                    {selectedCustomer.phone && <div>{selectedCustomer.phone}</div>}
                    {selectedCustomer.email && <div>{selectedCustomer.email}</div>}
                  </div>
                )}
              </div>

              {/* Customer info badges */}
              {selectedCustomer && (
                <div className="space-y-3">
                  {/* Tier badge */}
                  <div className="flex items-center gap-2">
                    <Badge variant={pricingTier === 'wholesale' ? 'default' : pricingTier === 'retail' ? 'secondary' : 'outline'}>
                      {pricingTier.charAt(0).toUpperCase() + pricingTier.slice(1)}
                    </Badge>
                    
                    {/* Pricing modifiers */}
                    {discountPercent && discountPercent > 0 && (
                      <Badge variant="outline" className="text-green-600 border-green-300">
                        -{discountPercent}% disc
                      </Badge>
                    )}
                    {markupPercent && markupPercent > 0 && (
                      <Badge variant="outline" className="text-blue-600 border-blue-300">
                        +{markupPercent}% markup
                      </Badge>
                    )}
                    {marginPercent && marginPercent > 0 && (
                      <Badge variant="outline" className="text-purple-600 border-purple-300">
                        {marginPercent}% margin
                      </Badge>
                    )}
                  </div>

                  {/* Tax status */}
                  <div className="flex items-center gap-2 text-sm">
                    <Shield className="w-3.5 h-3.5 text-muted-foreground" />
                    {selectedCustomer.isTaxExempt ? (
                      <span className="text-green-600 font-medium">Tax Exempt</span>
                    ) : selectedCustomer.taxRateOverride != null ? (
                      <span>Tax: {(Number(selectedCustomer.taxRateOverride) * 100).toFixed(2)}% (override)</span>
                    ) : (
                      <span className="text-muted-foreground">Tax: {(effectiveTaxRate * 100).toFixed(2)}% (default)</span>
                    )}
                  </div>

                  {/* Contact selector */}
                  {contacts && contacts.length > 0 && (
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Contact</Label>
                      <Select value={selectedContactId || ""} onValueChange={setSelectedContactId}>
                        <SelectTrigger className="h-8 text-sm">
                          <SelectValue placeholder="Select contact" />
                        </SelectTrigger>
                        <SelectContent>
                          {contacts.map((contact: any) => (
                            <SelectItem key={contact.id} value={contact.id}>
                              {contact.firstName} {contact.lastName}
                              {contact.isPrimary && " ★"}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Logistics Card */}
          <Card className="rounded-xl bg-card/80 border-border/60 shadow-md">
            <CardHeader className="pb-2 px-5 pt-4">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Truck className="w-4 h-4" />
                Fulfillment
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 px-5 pb-4">
              {/* Delivery method toggle */}
              <div className="grid grid-cols-3 gap-1 p-1 bg-muted rounded-lg">
                <Button
                  type="button"
                  variant={deliveryMethod === 'pickup' ? 'default' : 'ghost'}
                  size="sm"
                  className="gap-1.5"
                  onClick={() => setDeliveryMethod('pickup')}
                >
                  <Store className="w-3.5 h-3.5" />
                  Pickup
                </Button>
                <Button
                  type="button"
                  variant={deliveryMethod === 'ship' ? 'default' : 'ghost'}
                  size="sm"
                  className="gap-1.5"
                  onClick={() => {
                    setDeliveryMethod('ship');
                    // Pre-fill from customer shipping address
                    if (selectedCustomer) {
                      setShippingAddress({
                        street1: selectedCustomer.shippingStreet1 || '',
                        street2: selectedCustomer.shippingStreet2 || '',
                        city: selectedCustomer.shippingCity || '',
                        state: selectedCustomer.shippingState || '',
                        postalCode: selectedCustomer.shippingPostalCode || '',
                        country: selectedCustomer.shippingCountry || 'USA'
                      });
                    }
                  }}
                >
                  <Truck className="w-3.5 h-3.5" />
                  Ship
                </Button>
                <Button
                  type="button"
                  variant={deliveryMethod === 'deliver' ? 'default' : 'ghost'}
                  size="sm"
                  className="gap-1.5"
                  onClick={() => {
                    setDeliveryMethod('deliver');
                    if (selectedCustomer) {
                      setShippingAddress({
                        street1: selectedCustomer.shippingStreet1 || '',
                        street2: selectedCustomer.shippingStreet2 || '',
                        city: selectedCustomer.shippingCity || '',
                        state: selectedCustomer.shippingState || '',
                        postalCode: selectedCustomer.shippingPostalCode || '',
                        country: selectedCustomer.shippingCountry || 'USA'
                      });
                    }
                  }}
                >
                  <Building2 className="w-3.5 h-3.5" />
                  Deliver
                </Button>
              </div>

              {/* Address fields for ship/deliver */}
              {(deliveryMethod === 'ship' || deliveryMethod === 'deliver') && (
                <div className="space-y-3">
                  {/* Use customer address checkbox */}
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="use-customer-address"
                      checked={useCustomerAddress}
                      onCheckedChange={handleCopyCustomerAddress}
                      disabled={!customerHasAddress}
                    />
                    <Label 
                      htmlFor="use-customer-address" 
                      className={cn(
                        "text-sm cursor-pointer",
                        !customerHasAddress && "text-muted-foreground"
                      )}
                    >
                      Use customer address
                    </Label>
                  </div>
                  {!customerHasAddress && selectedCustomer && (
                    <p className="text-xs text-muted-foreground">No address on file for this customer</p>
                  )}

                  <div className="space-y-1.5">
                    <Label className="text-xs">Street Address</Label>
                    <Input
                      value={shippingAddress.street1}
                      onChange={(e) => {
                        setUseCustomerAddress(false);
                        setShippingAddress(prev => ({ ...prev, street1: e.target.value }));
                      }}
                      placeholder="123 Main St"
                      className="h-8 text-sm"
                    />
                  </div>
                  <Input
                    value={shippingAddress.street2}
                    onChange={(e) => {
                      setUseCustomerAddress(false);
                      setShippingAddress(prev => ({ ...prev, street2: e.target.value }));
                    }}
                    placeholder="Suite / Apt (optional)"
                    className="h-8 text-sm"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1.5">
                      <Label className="text-xs">City</Label>
                      <Input
                        value={shippingAddress.city}
                        onChange={(e) => {
                          setUseCustomerAddress(false);
                          setShippingAddress(prev => ({ ...prev, city: e.target.value }));
                        }}
                        className="h-8 text-sm"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">State</Label>
                      <Input
                        value={shippingAddress.state}
                        onChange={(e) => {
                          setUseCustomerAddress(false);
                          setShippingAddress(prev => ({ ...prev, state: e.target.value }));
                        }}
                        className="h-8 text-sm"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Postal Code</Label>
                      <Input
                        value={shippingAddress.postalCode}
                        onChange={(e) => {
                          setUseCustomerAddress(false);
                          setShippingAddress(prev => ({ ...prev, postalCode: e.target.value }));
                        }}
                        className="h-8 text-sm"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Country</Label>
                      <Input
                        value={shippingAddress.country}
                        onChange={(e) => {
                          setUseCustomerAddress(false);
                          setShippingAddress(prev => ({ ...prev, country: e.target.value }));
                        }}
                        className="h-8 text-sm"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Quote notes */}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Quote Notes</Label>
                <Textarea
                  value={quoteNotes}
                  onChange={(e) => setQuoteNotes(e.target.value)}
                  placeholder="Internal notes, special instructions..."
                  rows={4}
                  className="text-sm resize-none min-h-[80px]"
                />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* CENTER COLUMN: Line Item Builder + Item List */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        <div className="space-y-3 order-3 xl:order-2">
          {/* Product Configuration Panel */}
          <Card className="rounded-xl bg-card/80 border-border/60 shadow-md">
            <CardHeader className="pb-2 px-5 pt-4">
              <CardTitle className="text-sm font-medium">Add Line Item</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 px-5 pb-4">
              {/* Product & Variant selectors in a row */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Product</Label>
                  <Popover open={productSearchOpen} onOpenChange={setProductSearchOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        role="combobox"
                        aria-expanded={productSearchOpen}
                        className="h-9 w-full justify-between font-normal"
                      >
                        {selectedProductId
                          ? products?.find(p => p.id === selectedProductId)?.name || "Select product..."
                          : "Select product..."}
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[300px] p-0" align="start">
                      <Command shouldFilter={false}>
                        <CommandInput 
                          placeholder="Search products..." 
                          value={productSearchQuery}
                          onValueChange={setProductSearchQuery}
                        />
                        <CommandList>
                          <CommandEmpty>No products found.</CommandEmpty>
                          <CommandGroup>
                            {filteredProducts.map((product) => (
                              <CommandItem
                                key={product.id}
                                value={product.id}
                                onSelect={async () => {
                                  setSelectedProductId(product.id);
                                  setProductSearchOpen(false);
                                  setProductSearchQuery("");
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
                                }}
                              >
                                <Check
                                  className={cn(
                                    "mr-2 h-4 w-4",
                                    selectedProductId === product.id ? "opacity-100" : "opacity-0"
                                  )}
                                />
                                <span className="truncate">{product.name}</span>
                                {product.sku && (
                                  <span className="ml-2 text-xs text-muted-foreground">
                                    {product.sku}
                                  </span>
                                )}
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </div>

                {productVariants && productVariants.filter(v => v.isActive).length > 0 ? (
                  <div className="space-y-1.5">
                    <Label className="text-xs">Variant</Label>
                    <Select value={selectedVariantId || ""} onValueChange={setSelectedVariantId}>
                      <SelectTrigger className="h-9">
                        <SelectValue placeholder="Select variant" />
                      </SelectTrigger>
                      <SelectContent>
                        {productVariants.filter(v => v.isActive).map((variant) => (
                          <SelectItem key={variant.id} value={variant.id}>
                            {variant.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : (
                  <div /> /* Empty div to maintain grid */
                )}
              </div>

              {/* Dimensions & Quantity row */}
              <div className="grid grid-cols-3 gap-3">
                {requiresDimensions ? (
                  <>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Width (in)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={width}
                    onChange={(e) => setWidth(e.target.value)}
                    onBlur={() => {
                      if (draftLineItemId && quoteId) {
                        const widthVal = requiresDimensions ? parseFloat(width || "0") : 1;
                        patchDraftLineItem({ width: widthVal });
                      }
                    }}
                        className="h-9"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Height (in)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={height}
                    onChange={(e) => setHeight(e.target.value)}
                    onBlur={() => {
                      if (draftLineItemId && quoteId) {
                        const heightVal = requiresDimensions ? parseFloat(height || "0") : 1;
                        patchDraftLineItem({ height: heightVal });
                      }
                    }}
                        className="h-9"
                      />
                    </div>
                  </>
                ) : selectedProductId ? (
                  <div className="col-span-2 flex items-end">
                    <p className="text-xs text-muted-foreground pb-2">No dimensions required for this product</p>
                  </div>
                ) : (
                  <div className="col-span-2" />
                )}
                <div className="space-y-1.5">
                  <Label className="text-xs">Quantity</Label>
                  <Input
                    type="number"
                    min="1"
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                    onBlur={() => {
                      if (draftLineItemId && quoteId) {
                        const quantityVal = parseInt(quantity || "1", 10) || 1;
                        patchDraftLineItem({ quantity: quantityVal });
                      }
                    }}
                    className="h-9"
                  />
                </div>
              </div>

              {/* Product Options */}
              {selectedProduct && productOptions.length > 0 && (
                <div className="space-y-3 border-t pt-4">
                  <Label className="text-sm font-medium">Product Options</Label>
                  <div className="grid gap-2">
                    {productOptions
                      .filter((option) => option.type !== "attachment")
                      .map((option) => {
                      const selection = optionSelections[option.id];
                      const isSelected = !!selection;

                      return (
                        <div key={option.id} className="p-3 border rounded-md space-y-2">
                          {/* Checkbox type */}
                          {option.type === "checkbox" && (
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <Switch
                                  checked={isSelected}
                                  onCheckedChange={(checked) => {
                                    if (checked) {
                                      setOptionSelections(prev => ({
                                        ...prev,
                                        [option.id]: { value: true }
                                      }));
                                    } else {
                                      const { [option.id]: _, ...rest } = optionSelections;
                                      setOptionSelections(rest);
                                    }
                                  }}
                                />
                                <Label className="cursor-pointer text-sm">{option.label}</Label>
                              </div>
                              {option.amount != null && (
                                <Badge variant="secondary" className="text-xs">
                                  {formatOptionPriceLabel(option)}
                                </Badge>
                              )}
                            </div>
                          )}

                          {/* Quantity type */}
                          {option.type === "quantity" && (
                            <div className="space-y-2">
                              <div className="flex items-center justify-between">
                                <Label className="text-sm">{option.label}</Label>
                                {option.amount != null && (
                                  <Badge variant="secondary" className="text-xs">
                                    {formatOptionPriceLabel(option)}
                                  </Badge>
                                )}
                              </div>
                              <Input
                                type="number"
                                min="0"
                                value={typeof selection?.value === "number" ? selection.value : 0}
                                onChange={(e) => {
                                  const val = parseInt(e.target.value) || 0;
                                  if (val > 0) {
                                    setOptionSelections(prev => ({
                                      ...prev,
                                      [option.id]: { value: val }
                                    }));
                                  } else {
                                    const { [option.id]: _, ...rest } = optionSelections;
                                    setOptionSelections(rest);
                                  }
                                }}
                                className="h-8"
                              />
                            </div>
                          )}

                          {/* Toggle type (for sides: single/double) */}
                          {option.type === "toggle" && option.config?.kind === "sides" && (
                            <div className="space-y-2">
                              <Label className="text-sm">{option.label}</Label>
                              <div className="flex gap-2">
                                <Button
                                  type="button"
                                  variant={selection?.value === "single" ? "default" : "outline"}
                                  size="sm"
                                  className="flex-1"
                                  onClick={() => {
                                    setOptionSelections(prev => ({
                                      ...prev,
                                      [option.id]: { value: "single" }
                                    }));
                                  }}
                                >
                                  {option.config.singleLabel || "Single"}
                                </Button>
                                <Button
                                  type="button"
                                  variant={selection?.value === "double" ? "default" : "outline"}
                                  size="sm"
                                  className="flex-1"
                                  onClick={() => {
                                    setOptionSelections(prev => ({
                                      ...prev,
                                      [option.id]: { value: "double" }
                                    }));
                                  }}
                                >
                                  {option.config.doubleLabel || "Double"}
                                  {option.config.pricingMode !== "volume" && option.config.doublePriceMultiplier && (
                                    <span className="ml-1 text-xs">({option.config.doublePriceMultiplier}x)</span>
                                  )}
                                </Button>
                              </div>
                            </div>
                          )}

                          {/* Generic toggle (not sides) */}
                          {option.type === "toggle" && option.config?.kind !== "sides" && (
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <Switch
                                  checked={isSelected}
                                  onCheckedChange={(checked) => {
                                    if (checked) {
                                      setOptionSelections(prev => ({
                                        ...prev,
                                        [option.id]: { value: true }
                                      }));
                                    } else {
                                      const { [option.id]: _, ...rest } = optionSelections;
                                      setOptionSelections(rest);
                                    }
                                  }}
                                />
                                <Label className="cursor-pointer text-sm">{option.label}</Label>
                              </div>
                              {option.amount != null && (
                                <Badge variant="secondary" className="text-xs">
                                  {formatOptionPriceLabel(option)}
                                </Badge>
                              )}
                            </div>
                          )}

                          {/* Grommets with location selector */}
                          {option.config?.kind === "grommets" && isSelected && (
                            <div className="space-y-2 mt-2 pl-4 border-l-2 border-orange-500">
                              {option.config.spacingOptions && option.config.spacingOptions.length > 0 && (
                                <div className="space-y-1">
                                  <Label className="text-xs">Grommet Spacing</Label>
                                  <Select
                                    value={String(selection?.grommetsSpacingInches || option.config.defaultSpacingInches || option.config.spacingOptions[0])}
                                    onValueChange={(val) => {
                                      setOptionSelections(prev => ({
                                        ...prev,
                                        [option.id]: {
                                          ...prev[option.id],
                                          grommetsSpacingInches: parseInt(val)
                                        }
                                      }));
                                    }}
                                  >
                                    <SelectTrigger className="h-8">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {option.config.spacingOptions.map((sp: number) => (
                                        <SelectItem key={sp} value={String(sp)}>{sp}" spacing</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                              )}
                              <div className="grid grid-cols-2 gap-2">
                                <div className="space-y-1">
                                  <Label className="text-xs">Per Sign</Label>
                                  <Input
                                    type="number"
                                    min="0"
                                    value={selection?.grommetsPerSign ?? 4}
                                    onChange={(e) => {
                                      const count = parseInt(e.target.value) || 0;
                                      setOptionSelections(prev => ({
                                        ...prev,
                                        [option.id]: {
                                          ...prev[option.id],
                                          grommetsPerSign: count
                                        }
                                      }));
                                    }}
                                    className="h-8"
                                  />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-xs">Location</Label>
                                  <Select
                                    value={selection?.grommetsLocation || option.config.defaultLocation || "all_corners"}
                                    onValueChange={(val) => {
                                      let defaultCount = selection?.grommetsPerSign;
                                      if (!defaultCount) {
                                        if (val === "all_corners") defaultCount = 4;
                                        else if (val === "top_corners") defaultCount = 2;
                                        else defaultCount = 4;
                                      }
                                      setOptionSelections(prev => ({
                                        ...prev,
                                        [option.id]: { 
                                          ...prev[option.id],
                                          grommetsLocation: val,
                                          grommetsPerSign: defaultCount
                                        }
                                      }));
                                    }}
                                  >
                                    <SelectTrigger className="h-8">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="all_corners">All Corners</SelectItem>
                                      <SelectItem value="top_corners">Top Corners</SelectItem>
                                      <SelectItem value="top_even">Top Edge Even</SelectItem>
                                      <SelectItem value="custom">Custom</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>
                              </div>
                              {selection?.grommetsLocation === "custom" && (
                                <Textarea
                                  placeholder="Custom placement notes..."
                                  value={selection?.customPlacementNote || ""}
                                  onChange={(e) => {
                                    setOptionSelections(prev => ({
                                      ...prev,
                                      [option.id]: {
                                        ...prev[option.id],
                                        customPlacementNote: e.target.value
                                      }
                                    }));
                                  }}
                                  rows={2}
                                  className="text-xs"
                                />
                              )}
                            </div>
                          )}

                          {/* Hems option */}
                          {option.config?.kind === "hems" && isSelected && (
                            <div className="space-y-1 mt-2 pl-4 border-l-2 border-blue-500">
                              <Label className="text-xs">Hem Style</Label>
                              <Select
                                value={selection?.hemsType || option.config.defaultHems || "none"}
                                onValueChange={(val) => {
                                  setOptionSelections(prev => ({
                                    ...prev,
                                    [option.id]: {
                                      ...prev[option.id],
                                      hemsType: val
                                    }
                                  }));
                                }}
                              >
                                <SelectTrigger className="h-8">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {(option.config.hemsChoices || ["none", "all_sides", "top_bottom", "left_right"]).map((choice: string) => (
                                    <SelectItem key={choice} value={choice}>
                                      {choice === "none" ? "None" :
                                       choice === "all_sides" ? "All Sides" :
                                       choice === "top_bottom" ? "Top & Bottom" :
                                       choice === "left_right" ? "Left & Right" : choice}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          )}

                          {/* Pole Pockets option */}
                          {option.config?.kind === "pole_pockets" && isSelected && (
                            <div className="space-y-1 mt-2 pl-4 border-l-2 border-green-500">
                              <Label className="text-xs">Pole Pocket Location</Label>
                              <Select
                                value={selection?.polePocket || option.config.defaultPolePocket || "none"}
                                onValueChange={(val) => {
                                  setOptionSelections(prev => ({
                                    ...prev,
                                    [option.id]: {
                                      ...prev[option.id],
                                      polePocket: val
                                    }
                                  }));
                                }}
                              >
                                <SelectTrigger className="h-8">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {(option.config.polePocketChoices || ["none", "top", "bottom", "top_bottom"]).map((choice: string) => (
                                    <SelectItem key={choice} value={choice}>
                                      {choice === "none" ? "None" :
                                       choice === "top" ? "Top" :
                                       choice === "bottom" ? "Bottom" :
                                       choice === "top_bottom" ? "Top & Bottom" : choice}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {hasAttachmentOption && (
                <div className="space-y-2 border-t pt-4">
                  <Label className="text-sm font-medium">Attachments</Label>
                  {draftLineItemId && quoteId ? (
                    <LineItemAttachmentsPanel
                      quoteId={quoteId}
                      lineItemId={draftLineItemId}
                      defaultExpanded
                    />
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Select a product to create a line item and enable attachments.
                    </p>
                  )}
                </div>
              )}

              {/* Line Item Notes */}
              <div className="space-y-1.5">
                <Label className="text-xs">Line Item Notes</Label>
                <Textarea
                  placeholder="Special instructions for this item..."
                  value={lineItemNotes}
                  onChange={(e) => setLineItemNotes(e.target.value)}
                  rows={2}
                  className="text-sm resize-none"
                />
              </div>

              {/* Price display and Add button */}
              <div className="flex items-center justify-between pt-2 border-t">
                <div className="flex items-center gap-3">
                  {isCalculating && (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span className="text-sm">Calculating...</span>
                    </div>
                  )}
                  {calcError && (
                    <span className="text-sm text-destructive">{calcError}</span>
                  )}
                  {calculatedPrice !== null && !isCalculating && (
                    <div className="text-lg font-semibold font-mono">
                      ${calculatedPrice.toFixed(2)}
                    </div>
                  )}
                </div>
                <Button
                  onClick={handleAddLineItem}
                  disabled={!calculatedPrice || isCalculating}
                  className="gap-2"
                >
                  <Plus className="w-4 h-4" />
                  {draftLineItemId && lineItems.some(item => item.id === draftLineItemId) ? "Save changes" : "Add Item"}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Line Items Table */}
          <Card className="rounded-xl bg-card/80 border-border/60 shadow-md">
            <CardHeader className="pb-2 px-5 pt-4">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium">Line Items</CardTitle>
                <Badge variant="outline">{lineItems.length} item{lineItems.length !== 1 ? 's' : ''}</Badge>
              </div>
            </CardHeader>
            <CardContent className="px-5 pb-4">
              {lineItems.length === 0 ? (
                <div className="py-6 text-center text-muted-foreground">
                  <FileText className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No line items yet</p>
                  <p className="text-xs">Configure a product above to add items</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead className="text-center">Size</TableHead>
                      <TableHead className="text-center">Qty</TableHead>
                      <TableHead className="text-right">Price</TableHead>
                      <TableHead className="text-center">Artwork</TableHead>
                      <TableHead className="w-[80px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lineItems
                      .filter((item) => item.status !== "draft")
                      .map((item) => {
                      const hasAttachmentOption = Array.isArray(item.productOptions)
                        ? item.productOptions.some((opt) => opt.type === "attachment")
                        : false;
                      return (
                      <TableRow key={item.tempId || item.id}>
                        <TableCell>
                          <div className="font-medium text-sm">{item.productName}</div>
                          {item.variantName && (
                            <div className="text-xs text-muted-foreground">{item.variantName}</div>
                          )}
                          {item.selectedOptions && item.selectedOptions.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1">
                              {item.selectedOptions.map((opt: any, idx: number) => (
                                <Badge key={idx} variant="outline" className="text-xs py-0">
                                  {opt.optionName}
                                </Badge>
                              ))}
                            </div>
                          )}
                          {item.notes && (
                            <div className="text-xs italic text-muted-foreground mt-1 truncate max-w-[200px]">
                              {item.notes}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-center text-sm">
                          {item.width > 1 || item.height > 1 ? (
                            `${item.width}" × ${item.height}"`
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-center text-sm">{item.quantity}</TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          ${item.linePrice.toFixed(2)}
                        </TableCell>
                        <TableCell className="text-center">
                          {hasAttachmentOption && item.id ? (
                            <LineItemArtworkBadge
                              quoteId={quoteId}
                              lineItemId={item.id}
                              onClick={() => handleOpenAttachments(item)}
                            />
                          ) : hasAttachmentOption ? (
                            <span className="text-xs text-muted-foreground">Pending…</span>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8">
                                <ChevronDown className="w-4 h-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => {
                                if (item.id) {
                                  setDraftLineItemId(item.id);
                                }
                              }}>
                                <Pencil className="w-4 h-4 mr-2" />
                                Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleDuplicateLineItem(item.tempId || item.id || '')}>
                                <Copy className="w-4 h-4 mr-2" />
                                Duplicate
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => handleRemoveLineItem(item.tempId || item.id || '')}
                                className="text-destructive"
                              >
                                <Trash2 className="w-4 h-4 mr-2" />
                                Remove
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    )})}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* Artwork Hint Card - shown when there are line items */}
          {lineItems.length > 0 && (
            <Card className="rounded-xl bg-muted/30 border-border/40">
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <Paperclip className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div className="text-sm text-muted-foreground">
                    <p className="font-medium text-foreground">Per-Line-Item Artwork</p>
                    <p className="mt-1">
                      Click the artwork badge on any line item to attach files.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

        </div>

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* RIGHT COLUMN: Summary & Totals */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        <div className="space-y-3 order-2 xl:order-3">
          {/* Finished Line Items Card - compact view */}
          {lineItems.length > 0 && (
            <Card className="rounded-xl bg-card/80 border-border/60 shadow-md">
              <CardHeader className="pb-2 px-5 pt-4">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <ListOrdered className="w-4 h-4" />
                  Line Items ({lineItems.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y max-h-[300px] overflow-y-auto">
                  {lineItems.map((item, index) => (
                    <div key={index} className="px-4 py-2 hover:bg-muted/50 transition-colors">
                      <div className="flex justify-between items-start gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm truncate">
                            {products?.find((p: any) => p.id === item.productId)?.name || 'Unknown Product'}
                          </p>
                          {item.description && (
                            <p className="text-xs text-muted-foreground truncate">{item.description}</p>
                          )}
                          {(item.width || item.height) && (
                            <p className="text-xs text-muted-foreground">
                              {item.width}" × {item.height}"
                            </p>
                          )}
                        </div>
                        <div className="text-right shrink-0">
                          <p className="font-mono text-sm font-medium">${Number(item.lineTotal || 0).toFixed(2)}</p>
                          <p className="text-xs text-muted-foreground">Qty: {item.quantity}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Quote Summary Card */}
          <Card className="rounded-xl bg-card/70 border-border/60 shadow-lg">
            <CardHeader className="pb-2 px-5 pt-4">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <DollarSign className="w-4 h-4" />
                Quote Summary
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 px-5 pb-4">
              {/* Subtotal */}
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="font-mono">${subtotal.toFixed(2)}</span>
              </div>

              {/* Discounts - show if customer has discount */}
              {discountPercent && discountPercent > 0 && (
                <div className="flex justify-between text-sm text-green-600">
                  <span>Discount ({discountPercent}%)</span>
                  <span className="font-mono">-${(subtotal * discountPercent / 100).toFixed(2)}</span>
                </div>
              )}

              <Separator />

              {/* Tax breakdown */}
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">
                  Tax ({(effectiveTaxRate * 100).toFixed(2)}%)
                  {selectedCustomer?.isTaxExempt && (
                    <Badge variant="outline" className="ml-2 text-xs">Exempt</Badge>
                  )}
                </span>
                <span className="font-mono">${taxAmount.toFixed(2)}</span>
              </div>

              {/* Shipping placeholder - to be implemented */}
              {deliveryMethod === 'ship' && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Shipping</span>
                  <span className="font-mono text-muted-foreground">TBD</span>
                </div>
              )}

              <Separator />

              {/* Grand Total */}
              <div className="flex justify-between items-baseline pt-1">
                <span className="font-semibold">Grand Total</span>
                <span className="text-2xl font-bold font-mono">${grandTotal.toFixed(2)}</span>
              </div>
            </CardContent>
            <CardFooter className="flex-col gap-2 pt-0 px-5 pb-4">
              <Button
                className="w-full h-10"
                onClick={() => saveQuoteMutation.mutate()}
                disabled={saveQuoteMutation.isPending || lineItems.length === 0}
              >
                <Save className="w-4 h-4 mr-2" />
                {saveQuoteMutation.isPending ? "Saving..." : quote?.status === "draft" ? "Finalize Quote" : "Save Quote"}
              </Button>
              <div className="grid grid-cols-2 gap-2 w-full">
                <Button variant="outline" disabled size="sm">
                  <Send className="w-4 h-4 mr-2" />
                  Email
                </Button>
                <Button variant="secondary" disabled size="sm">
                  Convert to Order
                </Button>
              </div>
            </CardFooter>
          </Card>

          {/* Quick Info Card - only when customer selected */}
          {selectedCustomer && (
            <Card className="rounded-xl bg-card/80 border-border/60 shadow-md">
              <CardHeader className="pb-2 px-5 pt-4">
                <CardTitle className="text-xs font-medium text-muted-foreground">Customer Info</CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-1 px-5 pb-4">
                <p className="font-medium">{selectedCustomer.companyName}</p>
                {selectedCustomer.email && (
                  <p className="text-muted-foreground text-xs">{selectedCustomer.email}</p>
                )}
                {selectedCustomer.phone && (
                  <p className="text-muted-foreground text-xs">{selectedCustomer.phone}</p>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

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
            quoteId={quoteId}
            lineItemId={attachmentsItem?.id}
            productName={attachmentsItem?.productName}
            defaultExpanded
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
