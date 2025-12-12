import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Users, Shield } from "lucide-react";
import { CustomerSelect, type CustomerWithContacts } from "@/components/CustomerSelect";

type CustomerCardProps = {
    selectedCustomerId: string | null;
    selectedCustomer: CustomerWithContacts | undefined;
    selectedContactId: string | null;
    contacts: any[];
    effectiveTaxRate: number;
    pricingTier: string;
    discountPercent: number | null;
    markupPercent: number | null;
    marginPercent: number | null;
    deliveryMethod: 'pickup' | 'ship' | 'deliver';
    readOnly?: boolean;
    onCustomerChange: (customerId: string | null, customer?: CustomerWithContacts | undefined, contactId?: string | null | undefined) => void;
    onContactChange: (contactId: string | null) => void;
};

export function CustomerCard({
    selectedCustomerId,
    selectedCustomer,
    selectedContactId,
    contacts,
    effectiveTaxRate,
    pricingTier,
    discountPercent,
    markupPercent,
    marginPercent,
    readOnly = false,
    onCustomerChange,
    onContactChange,
}: CustomerCardProps) {
    return (
        <Card className="rounded-xl bg-card/80 border-border/60 shadow-md">
            <CardHeader className="pb-2 px-5 pt-4">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Users className="w-4 h-4" />
                    Customer Details
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 px-5 pb-4">
                <div className="space-y-1.5">
                    <CustomerSelect
                        value={selectedCustomerId}
                        onChange={onCustomerChange}
                        autoFocus={false}
                        label=""
                        placeholder="Search customers..."
                        disabled={readOnly}
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
                                <Select value={selectedContactId || ""} onValueChange={onContactChange} disabled={readOnly}>
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
    );
}
