import type { CustomerWithContacts } from "@/components/CustomerSelect";
import type { QuoteLineItemDraft } from "./types";

export type DirectOrderPayload = {
    customerId: string | null;
    contactId: string | null;
    lineItems: Array<Record<string, any>>;
    subtotal: number;
    taxRate: number;
    taxAmount: number;
    taxableSubtotal: number;
    discount: number;
    label: string | null;
    poNumber?: string;
    dueDate: string | null;
    requestedDueDate: string | null;
    promisedDate: string | null;
    priority: string;
    notesInternal?: string;
    shippingMethod: string;
    shippingMode: "single_shipment";
    shippingCents: number | null;
    shippingInstructions: string | null;
    idempotencyKey?: string;
};

export type BuildDirectOrderPayloadInput = {
    selectedCustomer?: CustomerWithContacts;
    selectedCustomerId: string | null;
    selectedContactId: string | null;
    quote?: unknown;
    lineItems: QuoteLineItemDraft[];
    subtotal: number;
    effectiveTaxRate: number;
    taxAmount: number;
    effectiveDiscount: number;
    jobLabel: string;
    orderPoNumber: string;
    requestedDueDate: string;
    orderPromisedDate: string;
    orderPriority: string;
    orderInternalNotes: string;
    deliveryMethod: string;
    shippingCents: number | null;
    quoteNotes: string;
    idempotencyKey?: string;
};

export function buildDirectOrderPayloadFromEditorState(input: BuildDirectOrderPayloadInput): DirectOrderPayload {
    const payloadCustomerId = input.selectedCustomer?.id ?? input.selectedCustomerId ?? null;
    const lineItemPayloads = input.lineItems
        .filter((li) => li.status !== "canceled" && !!li.productId)
        .map((li, index) => ({
            productId: li.productId,
            productName: li.productName,
            variantId: li.variantId ?? null,
            variantName: li.variantName ?? null,
            productType: li.productType || "wide_roll",
            description: li.description || li.productName || "Item",
            width: li.width,
            height: li.height,
            quantity: li.quantity,
            specsJson: li.specsJson || {},
            optionSelectionsJson: li.optionSelectionsJson ?? null,
            pbv2TreeVersionId: li.pbv2TreeVersionId ?? null,
            pbv2SnapshotJson: li.pbv2SnapshotJson ?? undefined,
            pricedAt: li.pricedAt ?? undefined,
            materialUsages: li.materialUsages ?? [],
            selectedOptions: li.selectedOptions || [],
            linePrice: li.linePrice ?? 0,
            totalPrice: li.linePrice ?? 0,
            priceBreakdown: li.priceBreakdown || {
                basePrice: li.linePrice ?? 0,
                optionsPrice: 0,
                total: li.linePrice ?? 0,
                formula: "",
            },
            sortOrder: li.displayOrder ?? index,
            productionNotes: li.productionNotes ?? null,
            requiresDesign: li.requiresDesign ?? false,
            requiresPrepress: li.requiresPrepress ?? null,
            requiresProofApproval: li.requiresProofApproval ?? null,
            priceOverride: li.priceOverride ?? null,
            overridePriceCents: li.overridePriceCents ?? null,
            overrideAt: li.overrideAt ?? null,
            overrideByUserId: li.overrideByUserId ?? null,
            overrideReason: li.overrideReason ?? null,
            pendingOrderAttachmentUploadIds: Array.isArray(li.pendingOrderAttachments)
                ? li.pendingOrderAttachments
                    .map((attachment) => attachment?.uploadId)
                    .filter((uploadId): uploadId is string => typeof uploadId === "string" && uploadId.trim().length > 0)
                : [],
        }));

    const dueDate = input.requestedDueDate ? new Date(`${input.requestedDueDate}T00:00:00.000Z`).toISOString() : null;
    const promisedDate = input.orderPromisedDate ? new Date(`${input.orderPromisedDate}T00:00:00.000Z`).toISOString() : null;

    return {
        customerId: payloadCustomerId,
        contactId: input.selectedContactId ?? null,
        lineItems: lineItemPayloads,
        subtotal: input.subtotal,
        taxRate: input.effectiveTaxRate,
        taxAmount: input.taxAmount,
        taxableSubtotal: input.subtotal,
        discount: input.effectiveDiscount,
        label: input.jobLabel || null,
        poNumber: input.orderPoNumber.trim() || undefined,
        dueDate,
        requestedDueDate: dueDate,
        promisedDate,
        priority: input.orderPriority || "normal",
        notesInternal: input.orderInternalNotes.trim() || undefined,
        shippingMethod: input.deliveryMethod,
        shippingMode: "single_shipment",
        shippingCents: input.shippingCents,
        shippingInstructions: input.quoteNotes || null,
        ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
    };
}
