import { useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import type { CustomerWithContacts } from "@/components/CustomerSelect";
import { ROUTES } from "@/config/routes";

type CustomerInfoFooterProps = {
    selectedCustomer: CustomerWithContacts | undefined;
    selectedContactId?: string | null;
};

export function CustomerInfoFooter({
    selectedCustomer,
    selectedContactId,
}: CustomerInfoFooterProps) {
    const [showCustomerAddress, setShowCustomerAddress] = useState(false);

    if (!selectedCustomer) return null;

    const selectedContact = selectedContactId
        ? selectedCustomer.contacts?.find(c => c.id === selectedContactId)
        : null;

    const companyName = selectedCustomer.companyName || null;
    const contactName = selectedContact
        ? `${selectedContact.firstName || ""} ${selectedContact.lastName || ""}`.trim() || null
        : null;

    const email = selectedContact?.email || selectedCustomer.email || null;
    const phone = selectedContact?.phone || selectedCustomer.phone || null;

    let addressLine1 = "";
    let addressLine2 = "";

    if (selectedContact?.street1) {
        addressLine1 = [selectedContact.street1, selectedContact.street2].filter(Boolean).join(", ");
        addressLine2 = [selectedContact.city, selectedContact.state, selectedContact.postalCode]
            .filter(Boolean)
            .join(", ");
    } else if (selectedCustomer.shippingStreet1) {
        addressLine1 = [selectedCustomer.shippingStreet1, selectedCustomer.shippingStreet2]
            .filter(Boolean)
            .join(", ");
        addressLine2 = [
            selectedCustomer.shippingCity,
            selectedCustomer.shippingState,
            selectedCustomer.shippingPostalCode,
        ]
            .filter(Boolean)
            .join(", ");
    } else if (selectedCustomer.billingStreet1) {
        addressLine1 = [selectedCustomer.billingStreet1, selectedCustomer.billingStreet2]
            .filter(Boolean)
            .join(", ");
        addressLine2 = [
            selectedCustomer.billingCity,
            selectedCustomer.billingState,
            selectedCustomer.billingPostalCode,
        ]
            .filter(Boolean)
            .join(", ");
    }

    if (!companyName) return null;

    const hasAddress = Boolean(addressLine1 || addressLine2);

    return (
        <Card className="rounded-lg border border-border/40 bg-card/30">
            <CardContent className="p-3">
                <div className="flex items-start justify-between gap-4">
                    {/* Left cluster: Company + Contact + Email/Phone */}
                    <div className="min-w-0 flex-1">
                        <Link
                            to={ROUTES.customers.detail(selectedCustomer.id)}
                            className="block text-sm font-semibold leading-tight text-foreground hover:underline break-words"
                            title={companyName}
                        >
                            {companyName}
                        </Link>

                        {(contactName || email || phone) && (
                            <div className="mt-0.5 space-y-0.5">
                                {contactName && (
                                    <div className="text-xs leading-tight text-muted-foreground break-words" title={contactName}>
                                        {contactName}
                                    </div>
                                )}

                                {(email || phone) && (
                                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs leading-tight text-muted-foreground">
                                        {email && (
                                            <span className="font-mono break-all" title={email}>
                                                {email}
                                            </span>
                                        )}
                                        {phone && (
                                            <span className="font-mono break-all" title={phone}>
                                                {phone}
                                            </span>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Right cluster: Address (secondary, right-aligned) + toggle */}
                    <div className="shrink-0 text-right">
                        {hasAddress && (
                            <button
                                type="button"
                                onClick={() => setShowCustomerAddress(v => !v)}
                                className="text-[11px] text-muted-foreground hover:text-foreground underline underline-offset-4 print:hidden"
                            >
                                {showCustomerAddress ? "Hide address" : "Show address"}
                            </button>
                        )}

                        {hasAddress && (
                            <div className="mt-1 max-w-[18rem] text-xs leading-tight text-muted-foreground">
                                <div className="hidden print:block whitespace-normal break-words">
                                    {addressLine1 && <div>{addressLine1}</div>}
                                    {addressLine2 && <div>{addressLine2}</div>}
                                </div>
                                {showCustomerAddress && (
                                    <div className="space-y-0.5 print:hidden whitespace-normal break-words">
                                        {addressLine1 && <div>{addressLine1}</div>}
                                        {addressLine2 && <div>{addressLine2}</div>}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}
