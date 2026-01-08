import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Truck, FileText, AlertCircle } from "lucide-react";
import { FulfillmentStatusBadge } from "@/components/FulfillmentStatusBadge";

type FulfillmentMethod = 'pickup' | 'ship' | 'deliver';

type ShipToAddress = {
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

type FulfillmentShippingPanelProps = {
  mode: 'quote' | 'order';
  fulfillmentMethod: FulfillmentMethod;
  fulfillmentStatus?: string | null;
  shipToAddress?: ShipToAddress | null;
  shippingInstructions?: string | null;
  shipments?: any[];
  isManagerOrHigher?: boolean;
  readOnly?: boolean; // For quote edit mode control
  // Quote-specific
  quoteNotes?: string | null;
  // Handlers (all optional for quote mode)
  onFulfillmentMethodChange?: (method: FulfillmentMethod) => void;
  onFulfillmentStatusChange?: (status: string) => void;
  onShippingInstructionsChange?: (instructions: string) => void;
  onQuoteNotesChange?: (notes: string) => void;
  onGeneratePackingSlip?: () => void;
  onAddShipment?: () => void;
  isGeneratingPackingSlip?: boolean;
};

/**
 * Unified Fulfillment & Shipping panel for both Quote and Order detail pages
 * - Quote mode: Read-only preview with helper text
 * - Order mode: Full interactive features
 */
export function FulfillmentShippingPanel({
  mode,
  fulfillmentMethod,
  fulfillmentStatus,
  shipToAddress,
  shippingInstructions,
  quoteNotes,
  shipments = [],
  isManagerOrHigher = false,
  readOnly = false,
  onFulfillmentMethodChange,
  onFulfillmentStatusChange,
  onShippingInstructionsChange,
  onQuoteNotesChange,
  onGeneratePackingSlip,
  onAddShipment,
  isGeneratingPackingSlip = false,
}: FulfillmentShippingPanelProps) {
  const isQuoteMode = mode === 'quote';
  const isPickup = fulfillmentMethod === 'pickup';
  const isEditable = !readOnly && !!onFulfillmentMethodChange;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <CardTitle className="text-lg font-medium">Fulfillment</CardTitle>
            {isQuoteMode && (
              <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                <AlertCircle className="w-3 h-3" />
                Shipping finalized after conversion to order
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Select
              value={fulfillmentMethod}
              onValueChange={(value) => onFulfillmentMethodChange?.(value as FulfillmentMethod)}
              disabled={!isEditable}
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
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isPickup ? (
          <div className="space-y-2">
            <label className="text-sm font-medium">
              {isQuoteMode ? 'Notes' : 'Pickup notes'}
            </label>
            {isQuoteMode && !isEditable ? (
              <div className="text-sm text-muted-foreground rounded-md border border-border/50 bg-muted/20 p-3">
                {quoteNotes || 'Customer will pick up order at your location.'}
              </div>
            ) : (
              <Textarea
                placeholder={isQuoteMode ? "Add notes, instructions, etc." : "Add pickup instructions, contact info, dock hours, etc."}
                value={isQuoteMode ? (quoteNotes || '') : (shippingInstructions || '')}
                onChange={(e) => isQuoteMode ? onQuoteNotesChange?.(e.target.value) : onShippingInstructionsChange?.(e.target.value)}
                disabled={readOnly}
                rows={3}
              />
            )}
          </div>
        ) : (
          <>
            {/* Ship To Address */}
            <div className="space-y-3">
              <div className="text-sm font-medium">Ship To</div>
              {shipToAddress && (shipToAddress.company || shipToAddress.name || shipToAddress.address1) ? (
                <div className="space-y-1 text-sm text-muted-foreground rounded-md border border-border/50 bg-muted/20 p-3">
                  {(shipToAddress.company || shipToAddress.name) && (
                    <div className="text-foreground">
                      {shipToAddress.company || shipToAddress.name}
                    </div>
                  )}
                  {shipToAddress.company && shipToAddress.name && shipToAddress.company !== shipToAddress.name && (
                    <div>{shipToAddress.name}</div>
                  )}
                  {(shipToAddress.email || shipToAddress.phone) && (
                    <div className="grid grid-cols-1 gap-1 md:grid-cols-2 md:gap-3">
                      {shipToAddress.email && (
                        <span className="min-w-0 truncate font-mono" title={shipToAddress.email}>
                          {shipToAddress.email}
                        </span>
                      )}
                      {shipToAddress.phone && (
                        <span className="md:justify-self-end font-mono" title={shipToAddress.phone}>
                          {shipToAddress.phone}
                        </span>
                      )}
                    </div>
                  )}
                  {(shipToAddress.address1 || shipToAddress.address2) && (
                    <div>
                      {shipToAddress.address1 && <div>{shipToAddress.address1}</div>}
                      {shipToAddress.address2 && <div>{shipToAddress.address2}</div>}
                    </div>
                  )}
                  {(shipToAddress.city || shipToAddress.state || shipToAddress.postalCode) && (
                    <div>
                      {[shipToAddress.city, shipToAddress.state].filter(Boolean).join(', ')}
                      {shipToAddress.postalCode ? ` ${shipToAddress.postalCode}` : ''}
                    </div>
                  )}
                  {shipToAddress.country && <div>{shipToAddress.country}</div>}
                </div>
              ) : (
                <div className="text-sm text-muted-foreground italic">
                  No shipping address specified
                </div>
              )}
            </div>

            {isQuoteMode ? (
              <>
                <Separator />
                <div className="space-y-2">
                  <div className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                    <FileText className="w-4 h-4" />
                    Packing Slip
                  </div>
                  <div className="text-xs text-muted-foreground italic">
                    Available after order creation
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                    <Truck className="w-4 h-4" />
                    Shipment Tracking
                  </div>
                  <div className="text-xs text-muted-foreground italic">
                    Available after order creation
                  </div>
                </div>
              </>
            ) : (
              <>
                {/* Packing Slip */}
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Packing Slip</span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onGeneratePackingSlip}
                    disabled={isGeneratingPackingSlip}
                  >
                    <FileText className="h-4 w-4 mr-2" />
                    {isGeneratingPackingSlip ? 'Generating...' : 'Generate & View'}
                  </Button>
                </div>

                {/* Manual Status Override (Manager+) */}
                {isManagerOrHigher && (
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Manual Status Override</label>
                    <Select
                      value={fulfillmentStatus || 'pending'}
                      onValueChange={onFulfillmentStatusChange}
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

                {/* Shipments */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Shipments ({shipments.length})</span>
                    <Button variant="outline" size="sm" onClick={onAddShipment}>
                      <Truck className="h-4 w-4 mr-2" />
                      Add Shipment
                    </Button>
                  </div>

                  {shipments.length === 0 ? (
                    <div className="text-xs text-muted-foreground">No shipments yet.</div>
                  ) : (
                    <div className="space-y-2">
                      {shipments.map((shipment) => (
                        <div key={shipment.id} className="border rounded-lg p-3 space-y-2">
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
                              <div className="text-sm font-mono">{shipment.trackingNumber}</div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
