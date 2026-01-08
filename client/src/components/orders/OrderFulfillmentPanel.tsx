import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Edit, Truck, ExternalLink, Check, Edit as EditIcon, Trash2, FileText, ChevronsUpDown } from "lucide-react";
import { FulfillmentStatusBadge } from "@/components/FulfillmentStatusBadge";
import { format } from "date-fns";

type Mode = "order" | "quote";

type ShipToData = {
  company?: string | null;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
};

type Shipment = {
  id: string;
  carrier: string;
  trackingNumber: string;
  shippedAt: string;
  deliveredAt?: string | null;
  notes?: string | null;
};

type Customer = {
  id: string;
  companyName?: string | null;
  email?: string | null;
  phone?: string | null;
  shippingStreet1?: string | null;
  shippingCity?: string | null;
  shippingState?: string | null;
  shippingPostalCode?: string | null;
};

type OrderFulfillmentPanelProps = {
  mode?: Mode;
  parentType?: "order" | "quote"; // Controls which sections to show
  fulfillmentMethod: "pickup" | "ship" | "deliver";
  fulfillmentStatus?: string | null;
  shippingInstructions?: string | null;
  shipToData?: ShipToData;
  shippingCents?: number | null; // Shipping cost in cents (quote mode)
  shipments?: Shipment[];
  isManagerOrHigher?: boolean;
  canEditOrder?: boolean;
  isEditingFulfillment?: boolean;
  
  // Handlers (all optional for quote mode)
  onFulfillmentMethodChange?: (method: "pickup" | "ship" | "deliver") => void;
  onFulfillmentStatusChange?: (status: string) => void;
  onShippingInstructionsChange?: (instructions: string | null) => void;
  onShipToChange?: (data: Partial<ShipToData>) => void;
  onShippingCentsChange?: (cents: number | null) => void; // Save shipping cost (quote mode)
  onGeneratePackingSlip?: () => void;
  onAddShipment?: () => void;
  onEditShipment?: (shipment: Shipment) => void;
  onMarkDelivered?: (shipment: Shipment) => void;
  onDeleteShipment?: (shipmentId: string) => void;
  onEnterEdit?: () => void;
  onExitEdit?: () => void;
  onAutofillShipTo?: (customer: Customer) => void;
  onAddNewShipToAddress?: () => void;
  
  // For ship-to autofill
  customers?: Customer[];
  isCustomersLoading?: boolean;
  
  // State for autofill popover
  isShipToAutofillOpen?: boolean;
  setIsShipToAutofillOpen?: (open: boolean) => void;
  shipToAutofillQuery?: string;
  setShipToAutofillQuery?: (query: string) => void;
  
  // Loading states
  isGeneratingPackingSlip?: boolean;
  isAdminOrOwner?: boolean;
};

function getTrackingUrl(carrier: string, trackingNumber: string): string {
  const normalized = carrier.toLowerCase();
  if (normalized.includes("ups")) return `https://www.ups.com/track?tracknum=${trackingNumber}`;
  if (normalized.includes("fedex")) return `https://www.fedex.com/fedextrack/?tracknumbers=${trackingNumber}`;
  if (normalized.includes("usps")) return `https://tools.usps.com/go/TrackConfirmAction?qtc_tLabels1=${trackingNumber}`;
  if (normalized.includes("dhl")) return `https://www.dhl.com/en/express/tracking.html?AWB=${trackingNumber}`;
  return "#";
}

function normalizeNullableString(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export function OrderFulfillmentPanel({
  mode = "order",
  parentType = "order", // Default to order for backward compat
  fulfillmentMethod,
  fulfillmentStatus,
  shippingInstructions,
  shipToData,
  shippingCents,
  shipments = [],
  isManagerOrHigher = false,
  canEditOrder = false,
  isEditingFulfillment = false,
  onFulfillmentMethodChange,
  onFulfillmentStatusChange,
  onShippingInstructionsChange,
  onShipToChange,
  onShippingCentsChange,
  onGeneratePackingSlip,
  onAddShipment,
  onEditShipment,
  onMarkDelivered,
  onDeleteShipment,
  onEnterEdit,
  onExitEdit,
  onAutofillShipTo,
  onAddNewShipToAddress,
  customers = [],
  isCustomersLoading = false,
  isShipToAutofillOpen = false,
  setIsShipToAutofillOpen,
  shipToAutofillQuery = "",
  setShipToAutofillQuery,
  isGeneratingPackingSlip = false,
  isAdminOrOwner = false,
}: OrderFulfillmentPanelProps) {
  const isQuoteMode = mode === "quote";
  const suppressBlurRef = useRef(false);

  // Local draft state for shipping price input (allows typing without blocking)
  const [shippingDraft, setShippingDraft] = useState<string>(
    shippingCents != null ? (shippingCents / 100).toFixed(2) : ""
  );

  // Keep the input in sync when shippingCents hydrates/changes (e.g., reopening a quote)
  const [isEditingShippingDraft, setIsEditingShippingDraft] = useState(false);
  useEffect(() => {
    if (isEditingShippingDraft) return;
    setShippingDraft(shippingCents != null ? (shippingCents / 100).toFixed(2) : "");
  }, [shippingCents, isEditingShippingDraft]);

  // Refs for ship-to inputs
  const shipToCompanyInputRef = useRef<HTMLInputElement>(null);
  const shipToNameInputRef = useRef<HTMLInputElement>(null);
  const shipToEmailInputRef = useRef<HTMLInputElement>(null);
  const shipToPhoneInputRef = useRef<HTMLInputElement>(null);
  const shipToAddress1InputRef = useRef<HTMLInputElement>(null);
  const shipToAddress2InputRef = useRef<HTMLInputElement>(null);
  const shipToCityInputRef = useRef<HTMLInputElement>(null);
  const shipToStateInputRef = useRef<HTMLInputElement>(null);
  const shipToPostalCodeInputRef = useRef<HTMLInputElement>(null);

  const handleShipToBlur = (field: keyof ShipToData, value: string) => {
    if (suppressBlurRef.current) return;
    const nextValue = normalizeNullableString(value);
    if ((shipToData?.[field] ?? null) === nextValue) return;
    onShipToChange?.({ [field]: nextValue });
  };

  const handleAddNewShipToAddress = () => {
    suppressBlurRef.current = true;
    onAddNewShipToAddress?.();
    setTimeout(() => {
      suppressBlurRef.current = false;
    }, 100);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg font-medium">Fulfillment</CardTitle>
          <div className="flex items-center gap-2">
            <Select
              value={fulfillmentMethod}
              onValueChange={(value) => {
                const next = value as any;

                // If switching to pickup, clear persisted fulfillment pricing
                if (parentType === "quote" && next === "pickup") {
                  setShippingDraft("");
                  onShippingCentsChange?.(null);
                }

                onFulfillmentMethodChange?.(next);
              }}
              disabled={!canEditOrder}
            >
              <SelectTrigger className="h-8 w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pickup">Pickup</SelectItem>
                <SelectItem value="ship">Ship</SelectItem>
                <SelectItem value="deliver">Deliver</SelectItem>
              </SelectContent>
            </Select>
            {!isQuoteMode && fulfillmentStatus && (
              <FulfillmentStatusBadge status={fulfillmentStatus as any} />
            )}
            {!isQuoteMode && canEditOrder && !isEditingFulfillment && onEnterEdit && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={onEnterEdit}
                title="Edit Fulfillment"
              >
                <Edit className="h-4 w-4" />
              </Button>
            )}
            {!isQuoteMode && isEditingFulfillment && onExitEdit && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onExitEdit}
              >
                Done
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {fulfillmentMethod === "pickup" ? (
          <div className="space-y-2">
            <label className="text-sm font-medium">
              Pickup notes
            </label>
            <Textarea
              placeholder="Add pickup instructions, contact info, dock hours, etc."
              defaultValue={shippingInstructions ?? ""}
              disabled={!canEditOrder || (!isQuoteMode && !isEditingFulfillment)}
              onBlur={(e) => {
                const nextValue = normalizeNullableString(e.target.value);
                if ((shippingInstructions ?? null) === nextValue) return;
                onShippingInstructionsChange?.(nextValue);
              }}
            />
          </div>
        ) : (
          <>
            {/* Ship To */}
            <div className="space-y-3">
              <div className="text-sm font-medium">Ship To</div>

              {!isQuoteMode && isEditingFulfillment && setIsShipToAutofillOpen && (
                <div className="flex items-center gap-2">
                  <Popover open={isShipToAutofillOpen} onOpenChange={setIsShipToAutofillOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 flex-1 justify-between font-normal"
                        aria-expanded={isShipToAutofillOpen}
                      >
                        <span className="truncate">Search customers...</span>
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[460px] p-0" align="start">
                      <Command shouldFilter={false}>
                        <CommandInput
                          placeholder="Search customers..."
                          value={shipToAutofillQuery}
                          onValueChange={setShipToAutofillQuery}
                        />
                        <CommandList>
                          {isCustomersLoading ? (
                            <div className="p-4 text-sm text-muted-foreground text-center">Loading customers...</div>
                          ) : (
                            <>
                              <CommandEmpty>No customers found.</CommandEmpty>
                              {customers.map((customer) => {
                                const street = customer.shippingStreet1 || "";
                                const city = customer.shippingCity || "";
                                const state = customer.shippingState || "";
                                const postal = customer.shippingPostalCode || "";

                                const addressLeft = [street, city].filter(Boolean).join(", ");
                                const addressRight = [state, postal].filter(Boolean).join(" ");
                                const address = [addressLeft, addressRight].filter(Boolean).join(" • ");

                                const label = `${customer.companyName || customer.email || "Customer"} — ${address || "No shipping address"}`;
                                const searchValue = [customer.companyName, customer.email, customer.phone, customer.shippingStreet1, customer.shippingCity]
                                  .filter(Boolean)
                                  .join(" ");

                                return (
                                  <CommandItem
                                    key={customer.id}
                                    value={searchValue}
                                    onSelect={async () => {
                                      onAutofillShipTo?.(customer);
                                      setIsShipToAutofillOpen(false);
                                      setShipToAutofillQuery?.("");
                                    }}
                                  >
                                    <div className="flex flex-col min-w-0 flex-1">
                                      <div className="font-medium truncate" title={label}>
                                        {label}
                                      </div>
                                    </div>
                                  </CommandItem>
                                );
                              })}
                            </>
                          )}
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>

                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2 ml-auto"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={handleAddNewShipToAddress}
                  >
                    Add new address
                  </Button>
                </div>
              )}

              {!isEditingFulfillment ? (
                <div className="space-y-1 text-sm text-muted-foreground">
                  {(shipToData?.company || shipToData?.name) && (
                    <div className="text-foreground">
                      {shipToData?.company || shipToData?.name}
                    </div>
                  )}
                  {shipToData?.company && shipToData?.name && shipToData?.company !== shipToData?.name && (
                    <div>{shipToData?.name}</div>
                  )}

                  {(shipToData?.email || shipToData?.phone) && (
                    <div className="grid grid-cols-1 gap-1 md:grid-cols-2 md:gap-3">
                      {shipToData?.email && (
                        <span className="min-w-0 truncate font-mono" title={shipToData?.email}>
                          {shipToData?.email}
                        </span>
                      )}
                      {shipToData?.phone && (
                        <span className="md:justify-self-end font-mono" title={shipToData?.phone}>
                          {shipToData?.phone}
                        </span>
                      )}
                    </div>
                  )}

                  {(shipToData?.address1 || shipToData?.address2) && (
                    <div>
                      {shipToData?.address1 && <div>{shipToData?.address1}</div>}
                      {shipToData?.address2 && <div>{shipToData?.address2}</div>}
                    </div>
                  )}

                  {(shipToData?.city || shipToData?.state || shipToData?.postalCode) && (
                    <div>
                      {[shipToData?.city, shipToData?.state].filter(Boolean).join(", ")}
                      {shipToData?.postalCode ? ` ${shipToData?.postalCode}` : ""}
                    </div>
                  )}
                  
                  {!shipToData?.company && !shipToData?.name && !shipToData?.address1 && (
                    <div className="text-xs">No shipping address specified</div>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Company</label>
                    <Input
                      ref={shipToCompanyInputRef}
                      defaultValue={shipToData?.company ?? ""}
                      onBlur={(e) => handleShipToBlur("company", e.target.value)}
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Contact</label>
                    <Input
                      ref={shipToNameInputRef}
                      defaultValue={shipToData?.name ?? ""}
                      onBlur={(e) => handleShipToBlur("name", e.target.value)}
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Email</label>
                    <Input
                      ref={shipToEmailInputRef}
                      defaultValue={shipToData?.email ?? ""}
                      onBlur={(e) => handleShipToBlur("email", e.target.value)}
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Phone</label>
                    <Input
                      ref={shipToPhoneInputRef}
                      defaultValue={shipToData?.phone ?? ""}
                      onBlur={(e) => handleShipToBlur("phone", e.target.value)}
                    />
                  </div>

                  <div className="space-y-1 md:col-span-2">
                    <label className="text-xs text-muted-foreground">Address 1</label>
                    <Input
                      ref={shipToAddress1InputRef}
                      defaultValue={shipToData?.address1 ?? ""}
                      onBlur={(e) => handleShipToBlur("address1", e.target.value)}
                    />
                  </div>

                  <div className="space-y-1 md:col-span-2">
                    <label className="text-xs text-muted-foreground">Address 2</label>
                    <Input
                      ref={shipToAddress2InputRef}
                      defaultValue={shipToData?.address2 ?? ""}
                      onBlur={(e) => handleShipToBlur("address2", e.target.value)}
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">City</label>
                    <Input
                      ref={shipToCityInputRef}
                      defaultValue={shipToData?.city ?? ""}
                      onBlur={(e) => handleShipToBlur("city", e.target.value)}
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">State</label>
                    <Input
                      ref={shipToStateInputRef}
                      defaultValue={shipToData?.state ?? ""}
                      onBlur={(e) => handleShipToBlur("state", e.target.value)}
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Postal Code</label>
                    <Input
                      ref={shipToPostalCodeInputRef}
                      defaultValue={shipToData?.postalCode ?? ""}
                      onBlur={(e) => handleShipToBlur("postalCode", e.target.value)}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Shipping Price (Quote Mode Only) */}
            {parentType === "quote" && (fulfillmentMethod === "ship" || fulfillmentMethod === "deliver") && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Shipping Price</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                  <Input
                    type="text"
                    inputMode="decimal"
                    value={shippingDraft}
                    onFocus={() => setIsEditingShippingDraft(true)}
                    onChange={(e) => {
                      // Allow partial typing (e.g., "1", "12.", "12.5")
                      setShippingDraft(e.target.value);
                    }}
                    onBlur={(e) => {
                      const val = e.target.value.trim();
                      if (val === "" || val === "$") {
                        setShippingDraft("");
                        onShippingCentsChange?.(null);
                      } else {
                        // Remove any $ symbols and parse
                        const cleaned = val.replace(/[$,]/g, "");
                        const dollars = Number.parseFloat(cleaned);
                        if (Number.isFinite(dollars) && dollars >= 0) {
                          const cents = Math.round(dollars * 100);
                          setShippingDraft(dollars.toFixed(2));
                          onShippingCentsChange?.(cents);
                        } else {
                          // Invalid input, reset to last valid value
                          setShippingDraft(shippingCents != null ? (shippingCents / 100).toFixed(2) : "");
                        }
                      }

                      setIsEditingShippingDraft(false);
                    }}
                    placeholder="0.00"
                    className="pl-7"
                    disabled={!isEditingFulfillment}
                  />
                </div>
              </div>
            )}

            {/* Packing Slip (Order Mode Only) */}
            {parentType === "order" && (
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Packing Slip</span>
              <Button
                variant="outline"
                size="sm"
                onClick={onGeneratePackingSlip}
                disabled={isQuoteMode || isGeneratingPackingSlip}
              >
                <FileText className="h-4 w-4 mr-2" />
                {isGeneratingPackingSlip ? "Generating..." : "Generate & View"}
              </Button>
            </div>
            )}

            {/* Manual Status Override (Manager+, Order Mode Only) */}
            {parentType === "order" && isManagerOrHigher && onFulfillmentStatusChange && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Manual Status Override</label>
                <Select
                  value={fulfillmentStatus || "pending"}
                  onValueChange={(value) => onFulfillmentStatusChange(value as any)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="packed">Packed</SelectItem>
                    <SelectItem value="shipped">Shipped</SelectItem>
                    <SelectItem value="delivered">Delivered</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            <Separator />

            {/* Shipments (Order Mode Only) */}
            {parentType === "order" && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Shipments ({shipments.length})</span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onAddShipment}
                  disabled={isQuoteMode}
                >
                  <Truck className="h-4 w-4 mr-2" />
                  Add Shipment
                </Button>
              </div>

              {shipments.length === 0 ? (
                <div className="text-xs text-muted-foreground">No shipments yet.</div>
              ) : (
                <div className="space-y-2">
                  {shipments.map((shipment) => (
                    <div
                      key={shipment.id}
                      className="border rounded-lg p-3 space-y-2"
                    >
                      <div className="flex items-start justify-between">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-xs">
                              {shipment.carrier}
                            </Badge>
                            {shipment.deliveredAt && (
                              <Badge className="bg-green-500/10 text-green-500 border-green-500/20 text-xs">
                                Delivered
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-mono">
                              {shipment.trackingNumber}
                            </span>
                            {shipment.carrier !== "Other" && shipment.trackingNumber && (
                              <a
                                href={getTrackingUrl(shipment.carrier, shipment.trackingNumber)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-primary hover:underline"
                              >
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            Shipped: {format(new Date(shipment.shippedAt), "MMM d, yyyy h:mm a")}
                          </div>
                          {shipment.deliveredAt && (
                            <div className="text-xs text-muted-foreground">
                              Delivered: {format(new Date(shipment.deliveredAt), "MMM d, yyyy h:mm a")}
                            </div>
                          )}
                          {shipment.notes && (
                            <div className="text-xs text-muted-foreground italic mt-1">
                              {shipment.notes}
                            </div>
                          )}
                        </div>
                        {!isQuoteMode && (
                          <div className="flex items-center gap-1">
                            {!shipment.deliveredAt && onMarkDelivered && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => onMarkDelivered(shipment)}
                                title="Mark as delivered"
                              >
                                <Check className="h-4 w-4" />
                              </Button>
                            )}

                            {onEditShipment && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => onEditShipment(shipment)}
                                title="Edit shipment"
                              >
                                <EditIcon className="h-4 w-4" />
                              </Button>
                            )}
                            
                            {isAdminOrOwner && onDeleteShipment && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => onDeleteShipment(shipment.id)}
                                className="text-destructive hover:text-destructive"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
