import { forwardRef, useRef, useState } from "react";
import { DocumentMetaCard } from "@/components/DocumentMetaCard";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Calendar, X } from "lucide-react";
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
    const tagInputRef = useRef<HTMLInputElement | null>(null);
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

    const commitTagInput = (raw: string) => {
        const parts = raw
            .split(",")
            .map(s => s.trim())
            .filter(Boolean);

        if (parts.length === 0) {
            setTagInput("");
            return;
        }

        for (const t of parts) {
            onAddTag?.(t);
        }
        setTagInput("");
    };

    const handleTagKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        const isCommitKey = e.key === "Enter" || e.key === "," || e.key === "Comma";
        if (isCommitKey) {
            e.preventDefault();
            commitTagInput(tagInput);
        } else if (e.key === "Backspace" && tagInput === "" && tags.length > 0) {
            // Remove last tag when backspace is pressed on empty input
            e.preventDefault();
            onRemoveTag?.(tags[tags.length - 1]);
        }
    };

    return (
        <DocumentMetaCard>
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
                        <Label className="text-xs text-muted-foreground">Job Label</Label>
                        {readOnly ? (
                            <div className="h-9 px-3 rounded-md bg-muted/30 border border-border/50 flex items-center text-sm">
                                <span className="truncate">{jobLabel || "—"}</span>
                            </div>
                        ) : (
                            <Input
                                value={jobLabel}
                                onChange={(e) => onJobLabelChange(e.target.value)}
                                placeholder="Job name or reference"
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
                                    className="h-9 pr-9 [&::-webkit-calendar-picker-indicator]:opacity-0 [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:right-0 [&::-webkit-calendar-picker-indicator]:w-9 [&::-webkit-calendar-picker-indicator]:h-full [&::-webkit-calendar-picker-indicator]:cursor-pointer"
                                />
                                <Calendar className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            </div>
                        )}
                    </div>
                </div>

                {/* Tags section - only show if handlers are provided (tags are functional) */}
                {onAddTag && onRemoveTag && (
                    <div
                        className="min-h-9 rounded-md bg-muted/30 border border-border/50 px-2 py-1 flex flex-wrap items-center gap-1.5 cursor-text focus-within:ring-1 focus-within:ring-ring/20"
                        onClick={() => tagInputRef.current?.focus()}
                        role="group"
                        aria-label="Tags"
                    >
                        {tags.map((t) => (
                            <Badge key={t} variant="secondary" className="h-7 px-2.5 py-0.5 text-xs flex items-center gap-1">
                                {t}
                                {!readOnly && (
                                    <button
                                        type="button"
                                        onClick={() => onRemoveTag(t)}
                                        className="ml-1 hover:bg-secondary/80 rounded-full p-1"
                                        aria-label={`Remove tag ${t}`}
                                    >
                                        <X className="h-3 w-3" />
                                    </button>
                                )}
                            </Badge>
                        ))}

                        {readOnly ? (
                            tags.length === 0 ? (
                                <span className="text-xs text-muted-foreground">—</span>
                            ) : null
                        ) : (
                            <Badge variant="secondary" className="h-7 px-2.5 py-0.5 text-xs flex items-center">
                                <input
                                    ref={tagInputRef}
                                    value={tagInput}
                                    onChange={(e) => setTagInput(e.target.value)}
                                    onKeyDown={handleTagKeyDown}
                                    placeholder="Add Tag"
                                    className="w-[7rem] min-w-[7rem] bg-transparent outline-none text-xs font-semibold placeholder:text-muted-foreground/70"
                                />
                            </Badge>
                        )}
                    </div>
                )}
        </DocumentMetaCard>
    );
});

CustomerCard.displayName = "CustomerCard";
