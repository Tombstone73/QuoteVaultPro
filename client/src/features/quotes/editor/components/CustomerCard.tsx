import { forwardRef, useImperativeHandle, useRef, useState, type ReactNode } from "react";
import { DocumentMetaCard } from "@/components/DocumentMetaCard";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Separator } from "@/components/ui/separator";
import { formatPhoneForDisplay, phoneToTelHref } from "@/lib/utils";
import { Calendar, X } from "lucide-react";
import { CustomerSelect, type CustomerWithContacts, type CustomerSelectRef } from "@/components/CustomerSelect";
import { ContactSelect } from "@/components/ContactSelect";
import { getContactDisplayName, type ContactPickerContact } from "@/lib/contactPicker";

export type CustomerCardRef = {
    commitPendingFlags: () => void;
};

type CustomerCardProps = {
    selectedCustomerId: string | null;
    selectedCustomer: CustomerWithContacts | undefined;
    selectedContactId: string | null;
    selectedContact?: ContactPickerContact | null;
    contacts: any[];
    jobLabel: string;
    requestedDueDate: string; // YYYY-MM-DD
    poNumber?: string;
    promisedDate?: string; // YYYY-MM-DD
    priority?: string;
    showOrderFields?: boolean;
    orderInternalNotes?: ReactNode;
    orderFulfillment?: ReactNode;
    tags?: string[];
    effectiveTaxRate: number;
    pricingTier: string;
    discountPercent: number | null;
    markupPercent: number | null;
    marginPercent: number | null;
    deliveryMethod: 'pickup' | 'ship' | 'deliver';
    readOnly?: boolean;
    onCustomerChange: (customerId: string | null, customer?: CustomerWithContacts | undefined, contactId?: string | null | undefined) => void;
    onContactChange: (contactId: string | null, contact?: ContactPickerContact | null) => void;
    onContactResolved?: (contact: ContactPickerContact | null) => void;
    onJobLabelChange: (label: string) => void;
    onRequestedDueDateChange: (date: string) => void;
    onPoNumberChange?: (poNumber: string) => void;
    onPromisedDateChange?: (date: string) => void;
    onPriorityChange?: (priority: string) => void;
    onAddTag?: (tag: string) => void;
    onRemoveTag?: (tag: string) => void;
};

export const CustomerCard = forwardRef<CustomerSelectRef, CustomerCardProps>(({
    selectedCustomerId,
    selectedCustomer,
    selectedContactId,
    selectedContact: selectedContactFromPicker = null,
    contacts,
    jobLabel,
    requestedDueDate,
    poNumber = "",
    promisedDate = "",
    priority = "normal",
    showOrderFields = false,
    orderInternalNotes,
    orderFulfillment,
    tags = [],
    effectiveTaxRate,
    pricingTier,
    discountPercent,
    markupPercent,
    marginPercent,
    readOnly = false,
    onCustomerChange,
    onContactChange,
    onContactResolved,
    onJobLabelChange,
    onRequestedDueDateChange,
    onPoNumberChange,
    onPromisedDateChange,
    onPriorityChange,
    onAddTag,
    onRemoveTag,
}, ref) => {
    const [tagInput, setTagInput] = useState("");
    const tagInputRef = useRef<HTMLInputElement | null>(null);
    const customerSelectRef = useRef<CustomerSelectRef | null>(null);
    const [showCustomerAddress, setShowCustomerAddress] = useState(false);

    const selectedContact = selectedContactId
        ? (selectedContactFromPicker?.id === selectedContactId ? selectedContactFromPicker : null)
            ?? contacts?.find((x: any) => x.id === selectedContactId)
        : null;

    const contactLabel = (() => {
        const c = contacts?.find((x: any) => x.id === selectedContactId);
        if (!c) return "—";
        const name = `${c.firstName || ""} ${c.lastName || ""}`.trim();
        return name || c.email || "—";
    })();

    const displayContactLabel = selectedContact ? getContactDisplayName(selectedContact) || contactLabel : contactLabel;

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

    const hasCustomerAddress = Boolean(customerAddress.line1 || customerAddress.line2);

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
            customerSelectRef.current?.focus();
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

    if (showOrderFields) {
        const distinctCustomerEmail = customerEmail?.trim().toLowerCase() !== contactEmail?.trim().toLowerCase() ? customerEmail : null;
        const distinctCustomerPhone = customerPhone?.replace(/\D/g, "") !== contactPhone?.replace(/\D/g, "") ? customerPhone : null;

        return (
            <div className="grid min-w-0 grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,0.8fr)]">
                    <section aria-label="Customer and contact" className="grid min-w-0 gap-4 rounded-lg border border-titan-border-subtle bg-titan-bg-card p-4 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                        <div className="min-w-0 space-y-2">
                            {readOnly ? (
                                <div className="space-y-2">
                                    <div className="text-sm font-medium">Customer</div>
                                    <div className="break-words text-sm font-semibold">{customerDisplayLabel}</div>
                                </div>
                            ) : (
                                <CustomerSelect ref={customerSelectRef} value={selectedCustomerId} onChange={onCustomerChange} autoFocus={false} label="Customer" placeholder="Search customers..." />
                            )}
                            {(distinctCustomerEmail || distinctCustomerPhone) && (
                                <div className="space-y-1 text-sm leading-5 text-muted-foreground">
                                    {distinctCustomerEmail && <a className="block break-words hover:text-foreground hover:underline" href={`mailto:${distinctCustomerEmail}`}>{distinctCustomerEmail}</a>}
                                    {distinctCustomerPhone && <a className="block hover:text-foreground hover:underline" href={phoneToTelHref(distinctCustomerPhone)}>{formatPhoneForDisplay(distinctCustomerPhone)}</a>}
                                </div>
                            )}
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                                {hasCustomerAddress && (
                                    <button type="button" onClick={() => setShowCustomerAddress(v => !v)} className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground">
                                        {showCustomerAddress ? "Hide address" : "Show address"}
                                    </button>
                                )}
                                {!readOnly && selectedCustomerId && (
                                    <button type="button" className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground" aria-label="Clear customer" onClick={() => onCustomerChange(null, undefined)}>Clear customer</button>
                                )}
                            </div>
                            {showCustomerAddress && hasCustomerAddress && (
                                <div className="text-sm leading-5 text-muted-foreground">{customerAddress.line1}<br />{customerAddress.line2}</div>
                            )}
                        </div>
                        <div className="min-w-0 space-y-2">
                            {readOnly ? (
                                <div className="space-y-2">
                                    <div className="text-sm font-medium">Contact</div>
                                    <div className="break-words text-sm font-semibold">{displayContactLabel}</div>
                                </div>
                            ) : (
                                <ContactSelect value={selectedContactId} customerId={selectedCustomerId} onChange={onContactChange} onResolvedContact={onContactResolved} label="Contact" placeholder="Search contacts..." />
                            )}
                            {(contactEmail || contactPhone) && (
                                <div className="space-y-1 text-sm leading-5 text-muted-foreground">
                                    {contactEmail && <a className="block break-words hover:text-foreground hover:underline" href={`mailto:${contactEmail}`}>{contactEmail}</a>}
                                    {contactPhone && <a className="block hover:text-foreground hover:underline" href={phoneToTelHref(contactPhone)}>{formatPhoneForDisplay(contactPhone)}</a>}
                                </div>
                            )}
                        </div>
                    </section>
                    <section aria-label="Order details" className="min-w-0 space-y-3 rounded-lg border border-titan-border-subtle bg-titan-bg-card p-4">
                        <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
                            <div className="space-y-1.5">
                                <label htmlFor="order-po-number" className="text-sm font-medium">PO #</label>
                                <Input id="order-po-number" value={poNumber} onChange={e => onPoNumberChange?.(e.target.value)} placeholder="Customer PO" readOnly={readOnly} className="h-9" />
                            </div>
                            <div className="min-w-0 space-y-1.5">
                                <label htmlFor="order-job-label" className="text-sm font-medium">Job Label</label>
                                <Input id="order-job-label" value={jobLabel} onChange={e => onJobLabelChange(e.target.value)} placeholder="Job name or reference" readOnly={readOnly} className="h-9" />
                            </div>
                            <div className="min-w-0 space-y-1.5">
                                <label htmlFor="order-due-date" className="text-sm font-medium">Due date</label>
                                <Input id="order-due-date" type="date" value={requestedDueDate} onChange={e => onRequestedDueDateChange(e.target.value)} readOnly={readOnly} className="h-9 min-w-0" />
                            </div>
                            <div className="min-w-0 space-y-1.5">
                                <label htmlFor="order-promised-date" className="text-sm font-medium">Promised date</label>
                                <Input id="order-promised-date" type="date" value={promisedDate} onChange={e => onPromisedDateChange?.(e.target.value)} readOnly={readOnly} className="h-9 min-w-0" />
                            </div>
                        </div>
                        {onAddTag && onRemoveTag && (
                            <div className="flex items-start gap-3">
                                <label htmlFor="order-flags" className="shrink-0 pt-2 text-sm font-medium">Flags</label>
                                <div role="group" aria-label="Flags" className="flex min-h-9 min-w-0 flex-1 flex-wrap items-center gap-1.5 rounded-md border border-input px-2 py-1 focus-within:ring-1 focus-within:ring-ring" onClick={() => tagInputRef.current?.focus()}>
                                    {tags.map(t => <Badge key={t} variant="secondary" className="gap-1 text-xs">{t}{!readOnly && <button type="button" aria-label={`Remove flag ${t}`} onClick={() => onRemoveTag(t)}><X className="h-3 w-3" /></button>}</Badge>)}
                                    {!readOnly ? <input id="order-flags" ref={tagInputRef} value={tagInput} onChange={e => setTagInput(e.target.value)} onKeyDown={handleTagKeyDown} onBlur={commitPendingFlag} placeholder="Add flag…" className="h-6 min-w-20 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground" /> : tags.length === 0 && <span className="text-sm text-muted-foreground">None</span>}
                                </div>
                            </div>
                        )}
                        {orderInternalNotes}
                    </section>
                    <section aria-label="Commercial and fulfillment" className="min-w-0 space-y-3 rounded-lg border border-titan-border-subtle bg-titan-bg-card p-4">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Commercial &amp; Fulfillment</div>
                        <div className="grid min-w-0 gap-1.5">
                            <label htmlFor="order-priority" className="text-sm font-medium text-muted-foreground">Priority</label>
                            <Select value={priority || "normal"} onValueChange={value => onPriorityChange?.(value)} disabled={readOnly}>
                                <SelectTrigger id="order-priority" className="h-9 min-w-0"><SelectValue /></SelectTrigger>
                                <SelectContent><SelectItem value="rush">Rush</SelectItem><SelectItem value="normal">Normal</SelectItem><SelectItem value="low">Low</SelectItem></SelectContent>
                            </Select>
                        </div>
                        {orderFulfillment}
                    </section>
            </div>
        );
    }

    return (
        <DocumentMetaCard
            className={showOrderFields ? "border-border/60 bg-card shadow-sm" : undefined}
            contentClassName={showOrderFields ? "space-y-0 p-0" : "p-4"}
        >
            {showOrderFields && (
                <div className="border-b border-border/60 px-5 py-4">
                    <h2 className="text-base font-semibold tracking-tight text-foreground">Customer &amp; order details</h2>
                    <p className="mt-0.5 text-xs text-muted-foreground">Identify the customer, job, and delivery dates.</p>
                </div>
            )}
            <div className={showOrderFields ? "grid grid-cols-1 gap-6 p-5 lg:grid-cols-[minmax(260px,0.8fr)_minmax(0,1.2fr)]" : "grid grid-cols-1 gap-6 lg:grid-cols-[380px_minmax(0,1fr)]"}>
                {/* Customer + Contact */}
                <div className="space-y-4">
                    <div className="space-y-2">
                        <div className="space-y-2">
                            {readOnly ? (
                                <div className="flex items-start justify-between gap-2 min-w-0">
                                    <div className="min-w-0 flex-1">
                                        <HoverCard openDelay={150} closeDelay={50}>
                                            <HoverCardTrigger asChild>
                                                <span
                                                    tabIndex={0}
                                                    className="block truncate text-sm font-semibold leading-5 text-foreground"
                                                    title={customerDisplayLabel || "—"}
                                                >
                                                    {customerDisplayLabel || "—"}
                                                </span>
                                            </HoverCardTrigger>
                                            <HoverCardContent className="w-[340px] max-w-[90vw] p-3" align="start" side="bottom">
                                                <div className="space-y-2">
                                                    {hasCustomerAddress && (
                                                        <div className="text-sm">
                                                            <div className="font-medium text-foreground">Billing</div>
                                                            <div className="mt-1 text-xs text-muted-foreground whitespace-pre-wrap">
                                                                {[customerAddress.line1, customerAddress.line2].filter(Boolean).join("\n") || "—"}
                                                            </div>
                                                        </div>
                                                    )}
                                                    {(customerEmail || customerPhone) && (
                                                        <div className="text-xs text-muted-foreground">
                                                            {customerEmail && <div className="font-mono break-words">{customerEmail}</div>}
                                                            {customerPhone && <div className="font-mono break-words">{formatPhoneForDisplay(customerPhone)}</div>}
                                                        </div>
                                                    )}
                                                </div>
                                            </HoverCardContent>
                                        </HoverCard>
                                    </div>
                                </div>
                            ) : (
                                <CustomerSelect
                                    ref={customerSelectRef}
                                    value={selectedCustomerId}
                                    onChange={onCustomerChange}
                                    autoFocus={false}
                                    label=""
                                    placeholder="Search customers..."
                                    disabled={readOnly}
                                />
                            )}

                            {showOrderFields && !readOnly && selectedCustomerId && (
                                <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs"
                                    aria-label="Clear customer" onClick={() => onCustomerChange(null, undefined)}>
                                    Clear customer
                                </Button>
                            )}

                            {hasCustomerAddress && (
                                <div className="text-[11px] leading-4 text-muted-foreground">
                                    <div className="hidden print:block">
                                        {customerAddress.line1 && <div>{customerAddress.line1}</div>}
                                        {customerAddress.line2 && <div>{customerAddress.line2}</div>}
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {showCustomerAddress && (
                                            <div className="space-y-0.5 print:hidden">
                                                {customerAddress.line1 && <div>{customerAddress.line1}</div>}
                                                {customerAddress.line2 && <div>{customerAddress.line2}</div>}
                                            </div>
                                        )}
                                        <button
                                            type="button"
                                            onClick={() => setShowCustomerAddress((v) => !v)}
                                            className="shrink-0 text-[11px] text-muted-foreground hover:text-foreground underline underline-offset-4 print:hidden"
                                        >
                                            {showCustomerAddress ? "Hide" : "Show"}
                                        </button>
                                    </div>
                                </div>
                            )}

                            {customerEmail && (
                                <div className="text-[11px] leading-4">
                                    <a
                                        href={`mailto:${customerEmail}`}
                                        className="font-mono text-muted-foreground hover:text-foreground hover:underline"
                                        title={customerEmail}
                                    >
                                        {customerEmail}
                                    </a>
                                </div>
                            )}

                            {customerPhone && (
                                <div className="text-[11px] leading-4">
                                    <a
                                        href={phoneToTelHref(customerPhone)}
                                        className="font-mono text-muted-foreground hover:text-foreground hover:underline"
                                        title={customerPhone}
                                    >
                                        {formatPhoneForDisplay(customerPhone)}
                                    </a>
                                </div>
                            )}
                        </div>

                        <Separator />

                        <div className="space-y-2">
                            {readOnly ? (
                                displayContactLabel && displayContactLabel !== "—" ? (
                                    <>
                                        <div className="flex items-start justify-between gap-2">
                                            <HoverCard openDelay={150} closeDelay={50}>
                                                <HoverCardTrigger asChild>
                                                    <span
                                                        tabIndex={0}
                                                        className="text-sm font-semibold text-foreground flex-1 min-w-0 truncate"
                                                        title={displayContactLabel}
                                                    >
                                                        {displayContactLabel}
                                                    </span>
                                                </HoverCardTrigger>
                                                <HoverCardContent className="w-[340px] max-w-[90vw] p-3" align="start" side="bottom">
                                                    <div className="space-y-2">
                                                        {(contactEmail || contactPhone) && (
                                                            <div className="text-xs text-muted-foreground">
                                                                {contactEmail && <div className="font-mono break-words">{contactEmail}</div>}
                                                                {contactPhone && <div className="font-mono break-words">{formatPhoneForDisplay(contactPhone)}</div>}
                                                            </div>
                                                        )}
                                                        {(selectedContact as any)?.street1 && (
                                                            <div className="text-xs text-muted-foreground whitespace-pre-wrap">
                                                                {[
                                                                    (selectedContact as any)?.street1,
                                                                    (selectedContact as any)?.street2,
                                                                    [
                                                                        (selectedContact as any)?.city,
                                                                        (selectedContact as any)?.state,
                                                                    ]
                                                                        .filter(Boolean)
                                                                        .join(", "),
                                                                    (selectedContact as any)?.postalCode,
                                                                ]
                                                                    .filter(Boolean)
                                                                    .join("\n")}
                                                            </div>
                                                        )}
                                                    </div>
                                                </HoverCardContent>
                                            </HoverCard>
                                        </div>
                                        {contactEmail && (
                                            <div className="text-[11px] leading-4">
                                                <a
                                                    href={`mailto:${contactEmail}`}
                                                    className="font-mono text-muted-foreground hover:text-foreground hover:underline"
                                                    title={contactEmail}
                                                >
                                                    {contactEmail}
                                                </a>
                                            </div>
                                        )}
                                        {contactPhone && (
                                            <div className="text-[11px] leading-4">
                                                <a
                                                    href={phoneToTelHref(contactPhone)}
                                                    className="font-mono text-muted-foreground hover:text-foreground hover:underline"
                                                    title={contactPhone}
                                                >
                                                    {formatPhoneForDisplay(contactPhone)}
                                                </a>
                                            </div>
                                        )}
                                    </>
                                ) : (
                                    <div className="flex items-start justify-between gap-2">
                                        <span className="text-sm text-muted-foreground">—</span>
                                    </div>
                                )
                            ) : (
                                <ContactSelect
                                    value={selectedContactId}
                                    customerId={selectedCustomerId}
                                    onChange={onContactChange}
                                    onResolvedContact={onContactResolved}
                                    label=""
                                    placeholder="Search contacts..."
                                    disabled={readOnly}
                                />
                            )}
                        </div>
                    </div>
                </div>

                {/* Quote/order meta */}
                <div className="min-w-0 space-y-4">
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                        {showOrderFields && (
                            <div className="space-y-1">
                                <div className="text-xs text-muted-foreground">PO #</div>
                                {readOnly ? (
                                    <div className="min-h-9 px-3 py-2 rounded-md bg-muted/30 border border-border/50 text-sm whitespace-normal break-words">
                                        {poNumber || "—"}
                                    </div>
                                ) : (
                                    <Input
                                        value={poNumber}
                                        onChange={(e) => onPoNumberChange?.(e.target.value)}
                                        placeholder="Customer PO"
                                        className="h-9"
                                    />
                                )}
                            </div>
                        )}

                        <div className="space-y-1">
                            <div className="text-xs text-muted-foreground">Job Label</div>
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
                            <div className="text-xs text-muted-foreground">Due date</div>
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

                        {showOrderFields && (
                            <>
                                <div className="space-y-1">
                                    <div className="text-xs text-muted-foreground">Promised date</div>
                                    {readOnly ? (
                                        <div className="min-h-9 px-3 py-2 rounded-md bg-muted/30 border border-border/50 flex items-center justify-between text-sm">
                                            <span className="whitespace-normal break-words">{promisedDate || "—"}</span>
                                            <Calendar className="h-4 w-4 text-muted-foreground" />
                                        </div>
                                    ) : (
                                        <div className="relative">
                                            <Input
                                                type="date"
                                                value={promisedDate}
                                                onChange={(e) => onPromisedDateChange?.(e.target.value)}
                                                className="h-9 pr-9 [&::-webkit-calendar-picker-indicator]:opacity-0 [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:right-0 [&::-webkit-calendar-picker-indicator]:w-9 [&::-webkit-calendar-picker-indicator]:h-full [&::-webkit-calendar-picker-indicator]:cursor-pointer"
                                            />
                                            <Calendar className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                        </div>
                                    )}
                                </div>

                                <div className="space-y-1">
                                    <div className="text-xs text-muted-foreground">Priority</div>
                                    {readOnly ? (
                                        <div className="min-h-9 px-3 py-2 rounded-md bg-muted/30 border border-border/50 text-sm capitalize">
                                            {priority || "normal"}
                                        </div>
                                    ) : (
                                        <Select value={priority || "normal"} onValueChange={(value) => onPriorityChange?.(value)}>
                                            <SelectTrigger className="h-9">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="rush">Rush</SelectItem>
                                                <SelectItem value="normal">Normal</SelectItem>
                                                <SelectItem value="low">Low</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    )}
                                </div>
                            </>
                        )}
                    </div>

                    {/* Tags section - only show if handlers are provided (tags are functional) */}
                    {onAddTag && onRemoveTag && (
                        <div className="flex items-start gap-3">
                            <div className="shrink-0 pt-2 text-xs text-muted-foreground">Flags</div>
                            <div
                                className="min-h-9 flex-1 rounded-md bg-muted/30 border border-border/50 px-2 py-1 flex flex-wrap items-center gap-1.5 cursor-text focus-within:ring-1 focus-within:ring-ring/20"
                                onClick={() => tagInputRef.current?.focus()}
                                role="group"
                                aria-label="Flags"
                            >
                                {tags.map((t) => (
                                    <Badge key={t} variant="secondary" className="h-7 px-2.5 py-0.5 text-xs flex items-center gap-1">
                                        {t}
                                        {!readOnly && (
                                            <button
                                                type="button"
                                                onClick={() => onRemoveTag(t)}
                                                className="ml-1 hover:bg-secondary/80 rounded-full p-1"
                                                aria-label={`Remove flag ${t}`}
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
                                            placeholder="Add Flag"
                                            className="w-[7rem] min-w-[7rem] bg-transparent outline-none text-xs font-semibold placeholder:text-muted-foreground/70"
                                        />
                                    </Badge>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </DocumentMetaCard>
    );
});

CustomerCard.displayName = "CustomerCard";
