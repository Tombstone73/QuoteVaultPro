import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { DocumentMetaCard } from "@/components/DocumentMetaCard";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Calendar, X } from "lucide-react";
import { CustomerSelect, type CustomerWithContacts, type CustomerSelectRef } from "@/components/CustomerSelect";

export type CustomerCardRef = {
    commitPendingFlags: () => void;
};

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

    const selectedContact = selectedContactId
        ? contacts?.find((x: any) => x.id === selectedContactId)
        : null;

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

    const customerEmail: string | null = (selectedCustomer as any)?.email || null;
    const customerPhone: string | null = (selectedCustomer as any)?.phone || null;
    const contactEmail: string | null = (selectedContact as any)?.email || null;
    const contactPhone: string | null = (selectedContact as any)?.phone || null;

    const resolveAddressLines = (preferred: any, fallback: any) => {
        // Prefer a contact-level address if present, else fall back to customer shipping/billing.
        let line1 = "";
        let line2 = "";

        if (preferred?.street1) {
            line1 = [preferred.street1, preferred.street2].filter(Boolean).join(", ");
            line2 = [preferred.city, preferred.state, preferred.postalCode].filter(Boolean).join(", ");
        } else if (fallback?.shippingStreet1) {
            line1 = [fallback.shippingStreet1, fallback.shippingStreet2].filter(Boolean).join(", ");
            line2 = [fallback.shippingCity, fallback.shippingState, fallback.shippingPostalCode].filter(Boolean).join(", ");
        } else if (fallback?.billingStreet1) {
            line1 = [fallback.billingStreet1, fallback.billingStreet2].filter(Boolean).join(", ");
            line2 = [fallback.billingCity, fallback.billingState, fallback.billingPostalCode].filter(Boolean).join(", ");
        }

        return { line1, line2 };
    };

    const customerAddress = resolveAddressLines(null, selectedCustomer);
    const contactAddress = resolveAddressLines(selectedContact, selectedCustomer);

    const handleHoverTriggerKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
        if (e.key === "Escape") {
            e.currentTarget.blur();
        }
    };

    const commitPendingFlag = () => {
        const v = tagInput.trim();
        if (v.length > 0) {
            // Check for duplicates case-insensitively
            const lowerV = v.toLowerCase();
            const isDuplicate = tags.some(t => t.toLowerCase() === lowerV);
            if (!isDuplicate) {
                onAddTag?.(v);
            }
        }
        setTagInput("");
    };

    // Expose commitPendingFlags method to parent via ref
    useImperativeHandle(ref, () => ({
        commitPendingFlags: commitPendingFlag,
        focus: () => {
            // Focus is handled by CustomerSelect internally - this is a no-op for CustomerCard
            // but required by CustomerSelectRef interface
        },
    }));

    const handleTagKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        const isCommitKey = e.key === "Enter" || e.key === "," || e.key === "Comma";
        if (isCommitKey) {
            e.preventDefault();
            commitPendingFlag();
        } else if (e.key === "Backspace" && tagInput === "" && tags.length > 0) {
            // Remove last tag when backspace is pressed on empty input
            e.preventDefault();
            onRemoveTag?.(tags[tags.length - 1]);
        }
    };

    return (
        <DocumentMetaCard contentClassName="space-y-2 px-4 py-3">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:gap-6">
                    {/* Left cluster: Customer + Contact */}
                    <div className="min-w-0 flex-1 space-y-2">
                        <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">Customer</Label>
                            {readOnly ? (
                                (() => {
                                    const hasDetails = Boolean(customerEmail || customerPhone || customerAddress.line1 || customerAddress.line2);
                                    const display = (
                                        <button
                                            type="button"
                                            onKeyDown={handleHoverTriggerKeyDown}
                                            className="w-full text-left min-h-9 px-3 py-2 rounded-md bg-muted/30 border border-border/50 text-sm whitespace-normal break-words"
                                        >
                                            {customerDisplayLabel}
                                        </button>
                                    );

                                    if (!hasDetails) {
                                        return (
                                            <div className="min-h-9 px-3 py-2 rounded-md bg-muted/30 border border-border/50 text-sm whitespace-normal break-words">
                                                {customerDisplayLabel}
                                            </div>
                                        );
                                    }

                                    return (
                                        <HoverCard openDelay={150} closeDelay={50}>
                                            <HoverCardTrigger asChild>
                                                {display}
                                            </HoverCardTrigger>
                                            <HoverCardContent className="w-[340px] max-w-[90vw] p-3">
                                                <div className="space-y-2">
                                                    <div className="text-sm font-semibold leading-tight break-words">
                                                        {customerDisplayLabel}
                                                    </div>
                                                    <div className="space-y-1 text-xs text-muted-foreground">
                                                        {customerEmail && (
                                                            <div className="break-all">
                                                                <a className="hover:underline" href={`mailto:${customerEmail}`}>
                                                                    {customerEmail}
                                                                </a>
                                                            </div>
                                                        )}
                                                        {customerPhone && (
                                                            <div className="break-all">
                                                                <a className="hover:underline" href={`tel:${customerPhone}`}>
                                                                    {customerPhone}
                                                                </a>
                                                            </div>
                                                        )}
                                                        {(customerAddress.line1 || customerAddress.line2) && (
                                                            <div className="pt-1 space-y-0.5 whitespace-normal break-words">
                                                                {customerAddress.line1 && <div>{customerAddress.line1}</div>}
                                                                {customerAddress.line2 && <div>{customerAddress.line2}</div>}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            </HoverCardContent>
                                        </HoverCard>
                                    );
                                })()
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

                        <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">Contact</Label>
                            {readOnly ? (
                                (() => {
                                    const title = contactLabel;
                                    const hasDetails = Boolean(contactEmail || contactPhone || contactAddress.line1 || contactAddress.line2);
                                    const display = (
                                        <button
                                            type="button"
                                            onKeyDown={handleHoverTriggerKeyDown}
                                            className="w-full text-left min-h-9 px-3 py-2 rounded-md bg-muted/30 border border-border/50 text-sm whitespace-normal break-words"
                                        >
                                            {contactLabel}
                                        </button>
                                    );

                                    if (!hasDetails) {
                                        return (
                                            <div className="min-h-9 px-3 py-2 rounded-md bg-muted/30 border border-border/50 text-sm whitespace-normal break-words">
                                                {contactLabel}
                                            </div>
                                        );
                                    }

                                    return (
                                        <HoverCard openDelay={150} closeDelay={50}>
                                            <HoverCardTrigger asChild>
                                                {display}
                                            </HoverCardTrigger>
                                            <HoverCardContent className="w-[340px] max-w-[90vw] p-3">
                                                <div className="space-y-2">
                                                    <div className="text-sm font-semibold leading-tight break-words">
                                                        {title}
                                                    </div>
                                                    <div className="space-y-1 text-xs text-muted-foreground">
                                                        {contactEmail && (
                                                            <div className="break-all">
                                                                <a className="hover:underline" href={`mailto:${contactEmail}`}>
                                                                    {contactEmail}
                                                                </a>
                                                            </div>
                                                        )}
                                                        {contactPhone && (
                                                            <div className="break-all">
                                                                <a className="hover:underline" href={`tel:${contactPhone}`}>
                                                                    {contactPhone}
                                                                </a>
                                                            </div>
                                                        )}
                                                        {(contactAddress.line1 || contactAddress.line2) && (
                                                            <div className="pt-1 space-y-0.5 whitespace-normal break-words">
                                                                {contactAddress.line1 && <div>{contactAddress.line1}</div>}
                                                                {contactAddress.line2 && <div>{contactAddress.line2}</div>}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            </HoverCardContent>
                                        </HoverCard>
                                    );
                                })()
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

                    {/* Center cluster: Job Label + Due date */}
                    <div className="min-w-0 flex-1 space-y-2">
                        <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">Job Label</Label>
                            {readOnly ? (
                                <div className="min-h-9 px-3 py-2 rounded-md bg-muted/30 border border-border/50 text-sm whitespace-normal break-words">
                                    {jobLabel || "—"}
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

                        <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">Due date</Label>
                            {readOnly ? (
                                <div className="min-h-9 px-3 py-2 rounded-md bg-muted/30 border border-border/50 flex items-center justify-between text-sm">
                                    <span className="whitespace-normal break-words">{requestedDueDate || "—"}</span>
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
                                    onBlur={commitPendingFlag}
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
