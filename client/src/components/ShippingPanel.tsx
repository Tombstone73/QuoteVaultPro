import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Truck, AlertCircle } from "lucide-react";

type ShippingPanelProps = {
  mode: 'quote' | 'order';
  deliveryMethod?: 'pickup' | 'ship' | 'deliver' | string | null;
  shippingAddress?: {
    street1?: string;
    street2?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
  } | null;
};

/**
 * Shipping/Fulfillment preview panel for Quote Detail
 * Shows a read-only preview of shipping information
 * Displays helper text that shipping is finalized after conversion to order
 */
export function ShippingPanel({ mode, deliveryMethod = 'pickup', shippingAddress }: ShippingPanelProps) {
  const method = (deliveryMethod || 'pickup') as 'pickup' | 'ship' | 'deliver';
  const hasAddress = shippingAddress?.street1 || shippingAddress?.city;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <CardTitle className="text-base font-medium">Shipping</CardTitle>
            {mode === 'quote' && (
              <CardDescription className="text-xs flex items-center gap-1.5">
                <AlertCircle className="w-3 h-3" />
                Finalized after conversion to order
              </CardDescription>
            )}
          </div>
          <Badge variant="outline" className="text-xs">
            {method === 'pickup' && 'Pickup'}
            {method === 'ship' && 'Ship'}
            {method === 'deliver' && 'Deliver'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Delivery method summary */}
        {method === 'pickup' ? (
          <div className="text-sm text-muted-foreground">
            Customer will pick up order at your location.
          </div>
        ) : (
          <>
            {/* Shipping address preview */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Ship To Address</label>
              {hasAddress ? (
                <div className="text-sm text-muted-foreground space-y-1 rounded-md border border-border/50 bg-muted/20 p-3">
                  {shippingAddress?.street1 && <div className="text-foreground">{shippingAddress.street1}</div>}
                  {shippingAddress?.street2 && <div>{shippingAddress.street2}</div>}
                  <div>
                    {[shippingAddress?.city, shippingAddress?.state, shippingAddress?.postalCode].filter(Boolean).join(", ")}
                  </div>
                  {shippingAddress?.country && <div>{shippingAddress.country}</div>}
                </div>
              ) : (
                <div className="text-sm text-muted-foreground italic">
                  No address specified yet
                </div>
              )}
            </div>

            {mode === 'quote' && (
              <>
                <Separator />
                
                {/* Disabled features hint */}
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
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
