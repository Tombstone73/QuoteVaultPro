import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Truck, Store, Building2 } from "lucide-react";
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
    onDeliveryMethodChange,
    onShippingAddressChange,
    onQuoteNotesChange,
    onCopyCustomerAddress,
}: FulfillmentCardProps) {
    return (
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
                        onClick={() => onDeliveryMethodChange('pickup')}
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
                                onCheckedChange={onCopyCustomerAddress}
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
                                onChange={(e) => onShippingAddressChange({ street1: e.target.value })}
                                placeholder="123 Main St"
                                className="h-8 text-sm"
                            />
                        </div>
                        <Input
                            value={shippingAddress.street2}
                            onChange={(e) => onShippingAddressChange({ street2: e.target.value })}
                            placeholder="Suite / Apt (optional)"
                            className="h-8 text-sm"
                        />
                        <div className="grid grid-cols-2 gap-2">
                            <div className="space-y-1.5">
                                <Label className="text-xs">City</Label>
                                <Input
                                    value={shippingAddress.city}
                                    onChange={(e) => onShippingAddressChange({ city: e.target.value })}
                                    className="h-8 text-sm"
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-xs">State</Label>
                                <Input
                                    value={shippingAddress.state}
                                    onChange={(e) => onShippingAddressChange({ state: e.target.value })}
                                    className="h-8 text-sm"
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
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-xs">Country</Label>
                                <Input
                                    value={shippingAddress.country}
                                    onChange={(e) => onShippingAddressChange({ country: e.target.value })}
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
                        onChange={(e) => onQuoteNotesChange(e.target.value)}
                        placeholder="Internal notes, special instructions..."
                        rows={4}
                        className="text-sm resize-none min-h-[80px]"
                    />
                </div>
            </CardContent>
        </Card>
    );
}
