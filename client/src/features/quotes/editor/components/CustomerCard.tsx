import { forwardRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Calendar, Tag, X } from "lucide-react";
import { CustomerSelect, type CustomerWithContacts, type CustomerSelectRef } from "@/components/CustomerSelect";

type CustomerCardProps = {
    selectedCustomerId: string | null;
    selectedCustomer: CustomerWithContacts | undefined;
    selectedContactId: string | null;
    contacts: any[];
    jobLabel: string;
    requestedDueDate: string; // YYYY-MM-DD
    tags?: string[];
    effectiveTaxRate: number;
    pricingTier: string;
    discountPercent: number | null;
    markupPercent: number | null;
    marginPercent: number | null;
    deliveryMethod: 'pickup' | 'ship' | 'deliver';
    readOnly?: boolean;
    onCustomerChange: (customerId: string | null, customer?: CustomerWithContacts | undefined, contactId?: string | null | undefined) => void;
    onContactChange: (contactId: string | null) => void;
    onJobLabelChange: (label: string) => void;
    onRequestedDueDateChange: (date: string) => void;
    onAddTag?: (tag: string) => void;
    onRemoveTag?: (tag: string) => void;
};

export const CustomerCard = forwardRef<CustomerSelectRef, CustomerCardProps>(({
    selectedCustomerId,
    selectedCustomer,
    selectedContactId,
    contacts,
    jobLabel,
    requestedDueDate,
    tags = [],
    effectiveTaxRate,
    pricingTier,
    discountPercent,
    markupPercent,
    marginPercent,
    readOnly = false,
    onCustomerChange,
    onContactChange,
    onJobLabelChange,
    onRequestedDueDateChange,
    onAddTag,
    onRemoveTag,
}, ref) => {
    const [tagInput, setTagInput] = useState("");
    const contactLabel = (() => {
        const c = contacts?.find((x: any) => x.id === selectedContactId);
        if (!c) return "—";
        const name = `${c.firstName || ""} ${c.lastName || ""}`.trim();
        return name || c.email || "—";
    })();

    const customerDisplayLabel = (() => {
        if (!selectedCustomer) return "—";
        if (selectedCustomer.companyName) return selectedCustomer.companyName;
        if (selectedCustomer.email) return selectedCustomer.email;
        return "—";
    })();

    const handleTagKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter" && tagInput.trim()) {
            e.preventDefault();
            onAddTag?.(tagInput.trim());
            setTagInput("");
        } else if (e.key === "Backspace" && tagInput === "" && tags.length > 0) {
            // Remove last tag when backspace is pressed on empty input
            e.preventDefault();
            onRemoveTag?.(tags[tags.length - 1]);
        }
    };

    return (
        <Card className="rounded-lg border border-border/40 bg-card/50">
            <CardContent className="space-y-3 px-4 pt-4 pb-4">
                <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">Customer</Label>
                        {readOnly ? (
                            <div className="h-9 px-3 rounded-md bg-muted/30 border border-border/50 flex items-center text-sm">
                                <span className="truncate">
                                    {customerDisplayLabel}
                                </span>
                            </div>
                        ) : (
                            <CustomerSelect
                                ref={ref}
                                value={selectedCustomerId}
                                onChange={onCustomerChange}
                                autoFocus={false}
                                label=""
                                placeholder="Search customers..."
                                disabled={readOnly}
                            />
                        )}
                    </div>

                    <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">Contact</Label>
                        {readOnly ? (
                            <div className="h-9 px-3 rounded-md bg-muted/30 border border-border/50 flex items-center text-sm">
                                <span className="truncate">{contactLabel}</span>
                            </div>
                        ) : (
                            <Select value={selectedContactId || ""} onValueChange={onContactChange} disabled={readOnly}>
                                <SelectTrigger className="h-9 text-sm">
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
                        )}
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">Job label / reference</Label>
                        {readOnly ? (
                            <div className="h-9 px-3 rounded-md bg-muted/30 border border-border/50 flex items-center text-sm">
                                <span className="truncate">{jobLabel || "—"}</span>
                            </div>
                        ) : (
                            <Input
                                value={jobLabel}
                                onChange={(e) => onJobLabelChange(e.target.value)}
                                placeholder="e.g., Lobby Window Vinyl (Phase 2)"
                                className="h-9"
                            />
                        )}
                    </div>

                    <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">Due date</Label>
                        {readOnly ? (
                            <div className="h-9 px-3 rounded-md bg-muted/30 border border-border/50 flex items-center justify-between text-sm">
                                <span className="truncate">{requestedDueDate || "—"}</span>
                                <Calendar className="h-4 w-4 text-muted-foreground" />
                            </div>
                        ) : (
                            <div className="relative">
                                <Input
                                    type="date"
                                    value={requestedDueDate}
                                    onChange={(e) => onRequestedDueDateChange(e.target.value)}
                                    className="h-9 pr-9"
                                />
                                <Calendar className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            </div>
                        )}
                    </div>
                </div>

                {/* Tags section - only show if handlers are provided (tags are functional) */}
                {onAddTag && onRemoveTag && (
                    <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground flex items-center gap-2">
                            <Tag className="h-3.5 w-3.5" />
                            Tags
                        </Label>
                        {readOnly ? (
                            <div className="flex flex-wrap gap-1.5">
                                {tags.length === 0 ? (
                                    <span className="text-xs text-muted-foreground">—</span>
                                ) : (
                                    tags.map((t) => (
                                        <Badge key={t} variant="secondary" className="text-[11px] py-0">
                                            {t}
                                        </Badge>
                                    ))
                                )}
                            </div>
                        ) : (
                            <>
                                <div className="flex flex-wrap gap-1.5 mb-1.5">
                                    {tags.length === 0 ? (
                                        <span className="text-xs text-muted-foreground">No tags</span>
                                    ) : (
                                        tags.map((t) => (
                                            <Badge key={t} variant="secondary" className="text-[11px] py-0 flex items-center gap-1">
                                                {t}
                                                <button
                                                    type="button"
                                                    onClick={() => onRemoveTag(t)}
                                                    className="ml-1 hover:bg-secondary/80 rounded-full p-0.5"
                                                    aria-label={`Remove tag ${t}`}
                                                >
                                                    <X className="h-3 w-3" />
                                                </button>
                                            </Badge>
                                        ))
                                    )}
                                </div>
                                <Input
                                    value={tagInput}
                                    onChange={(e) => setTagInput(e.target.value)}
                                    onKeyDown={handleTagKeyDown}
                                    placeholder="Type tag and press Enter"
                                    className="h-8 text-xs"
                                />
                            </>
                        )}
                    </div>
                )}
            </CardContent>
        </Card>
    );
});

CustomerCard.displayName = "CustomerCard";
