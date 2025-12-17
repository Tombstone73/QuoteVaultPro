import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Store, Truck, Building2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CustomerWithContacts } from "@/components/CustomerSelect";
import type { Address } from "../types";

type FulfillmentCardProps = {
    deliveryMethod: 'pickup' | 'ship' | 'deliver';
    shippingAddress: Address;
    quoteNotes: string;
    selectedCustomer: CustomerWithContacts | undefined;
    useCustomerAddress: boolean;
    customerHasAddress: boolean;
    readOnly?: boolean;
    onDeliveryMethodChange: (method: 'pickup' | 'ship' | 'deliver') => void;
    onShippingAddressChange: (updates: Partial<Address>) => void;
    onQuoteNotesChange: (notes: string) => void;
    onCopyCustomerAddress: (checked: boolean) => void;
};

export function FulfillmentCard({
    deliveryMethod,
    shippingAddress,
    quoteNotes,
    selectedCustomer,
    useCustomerAddress,
    customerHasAddress,
    readOnly = false,
    onDeliveryMethodChange,
    onShippingAddressChange,
    onQuoteNotesChange,
    onCopyCustomerAddress,
}: FulfillmentCardProps) {
    return (
        <Card className="rounded-lg border border-border/40 bg-card/50">
            <CardContent className="space-y-4 p-4">
                {/* Delivery method */}
                {readOnly ? (
                    <div className="flex items-center gap-1 rounded-lg border border-border/50 bg-muted/20 p-1">
                            <div
                                className={cn(
                                    "px-2 py-1 rounded-md text-xs",
                                    deliveryMethod === "pickup" ? "bg-primary text-primary-foreground" : "text-muted-foreground"
                                )}
                            >
                                Pickup
                            </div>
                            <div
                                className={cn(
                                    "px-2 py-1 rounded-md text-xs",
                                    deliveryMethod === "ship" ? "bg-primary text-primary-foreground" : "text-muted-foreground"
                                )}
                            >
                                Ship
                            </div>
                            <div
                                className={cn(
                                    "px-2 py-1 rounded-md text-xs",
                                    deliveryMethod === "deliver" ? "bg-primary text-primary-foreground" : "text-muted-foreground"
                                )}
                            >
                                Deliver
                            </div>
                        </div>
                ) : (
                    <div className="grid grid-cols-3 gap-1 p-1 bg-muted rounded-lg">
                        <Button
                            type="button"
                            variant={deliveryMethod === 'pickup' ? 'default' : 'ghost'}
                            size="sm"
                            className="gap-1.5"
                            onClick={() => onDeliveryMethodChange('pickup')}
                            disabled={readOnly}
                        >
                            <Store className="w-3.5 h-3.5" />
                            Pickup
                        </Button>
                        <Button
                            type="button"
                            variant={deliveryMethod === 'ship' ? 'default' : 'ghost'}
                            size="sm"
                            className="gap-1.5"
                            onClick={() => onDeliveryMethodChange('ship')}
                            disabled={readOnly}
                        >
                            <Truck className="w-3.5 h-3.5" />
                            Ship
                        </Button>
                        <Button
                            type="button"
                            variant={deliveryMethod === 'deliver' ? 'default' : 'ghost'}
                            size="sm"
                            className="gap-1.5"
                            onClick={() => onDeliveryMethodChange('deliver')}
                            disabled={readOnly}
                        >
                            <Building2 className="w-3.5 h-3.5" />
                            Deliver
                        </Button>
                    </div>
                )}

                {/* Address fields for ship/deliver */}
                {(deliveryMethod === 'ship' || deliveryMethod === 'deliver') && (
                    <div className="space-y-3">
                        {readOnly ? (
                            <div className="rounded-md border border-border/50 bg-muted/20 p-3 text-sm">
                                <div className="text-xs text-muted-foreground mb-1">Shipping Address</div>
                                <div className="space-y-0.5">
                                    <div className="text-foreground">{shippingAddress.street1 || "—"}</div>
                                    {shippingAddress.street2 && <div className="text-muted-foreground">{shippingAddress.street2}</div>}
                                    <div className="text-muted-foreground">
                                        {[shippingAddress.city, shippingAddress.state, shippingAddress.postalCode].filter(Boolean).join(", ") || "—"}
                                    </div>
                                    <div className="text-muted-foreground">{shippingAddress.country || "—"}</div>
                                </div>
                            </div>
                        ) : (
                            <>
                                {/* Use customer address checkbox */}
                                <div className="flex items-center gap-2">
                                    <Checkbox
                                        id="use-customer-address"
                                        checked={useCustomerAddress}
                                        onCheckedChange={onCopyCustomerAddress}
                                        disabled={!customerHasAddress || readOnly}
                                    />
                                    <Label
                                        htmlFor="use-customer-address"
                                        className={cn(
                                            "text-sm cursor-pointer",
                                            (!customerHasAddress || readOnly) && "text-muted-foreground"
                                        )}
                                    >
                                        Use customer address
                                    </Label>
                                </div>
                                {!customerHasAddress && selectedCustomer && (
                                    <p className="text-xs text-muted-foreground">No address on file for this customer</p>
                                )}

                                <div className="space-y-1.5">
                                    <Label className="text-xs">Address</Label>
                                    <Input
                                        value={shippingAddress.street1}
                                        onChange={(e) => onShippingAddressChange({ street1: e.target.value })}
                                        placeholder="123 Main St"
                                        className="h-8 text-sm"
                                        disabled={readOnly}
                                    />
                                </div>
                                <Input
                                    value={shippingAddress.street2}
                                    onChange={(e) => onShippingAddressChange({ street2: e.target.value })}
                                    placeholder="Suite/Apt (optional)"
                                    className="h-8 text-sm"
                                    disabled={readOnly}
                                />
                                <div className="grid grid-cols-2 gap-2">
                                    <div className="space-y-1.5">
                                        <Label className="text-xs">City</Label>
                                        <Input
                                            value={shippingAddress.city}
                                            onChange={(e) => onShippingAddressChange({ city: e.target.value })}
                                            className="h-8 text-sm"
                                            disabled={readOnly}
                                        />
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label className="text-xs">State</Label>
                                        <Input
                                            value={shippingAddress.state}
                                            onChange={(e) => onShippingAddressChange({ state: e.target.value })}
                                            className="h-8 text-sm"
                                            disabled={readOnly}
                                        />
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                    <div className="space-y-1.5">
                                        <Label className="text-xs">Postal Code</Label>
                                        <Input
                                            value={shippingAddress.postalCode}
                                            onChange={(e) => onShippingAddressChange({ postalCode: e.target.value })}
                                            className="h-8 text-sm"
                                            disabled={readOnly}
                                        />
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label className="text-xs">Country</Label>
                                        <Input
                                            value={shippingAddress.country}
                                            onChange={(e) => onShippingAddressChange({ country: e.target.value })}
                                            className="h-8 text-sm"
                                            disabled={readOnly}
                                        />
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                )}

                {/* Quote notes */}
                <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Notes</Label>
                    {readOnly ? (
                        <div className="rounded-md border border-border/50 bg-muted/20 p-3 text-sm text-foreground min-h-[80px] whitespace-pre-wrap">
                            {quoteNotes?.trim() ? quoteNotes : "—"}
                        </div>
                    ) : (
                        <Textarea
                            value={quoteNotes}
                            onChange={(e) => onQuoteNotesChange(e.target.value)}
                            placeholder="Internal notes or instructions"
                            rows={4}
                            className="text-sm resize-none min-h-[80px]"
                            readOnly={readOnly}
                            disabled={readOnly}
                        />
                    )}
                </div>
            </CardContent>
        </Card>
    );
}
