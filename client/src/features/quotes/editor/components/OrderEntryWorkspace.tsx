import type { ReactNode } from "react";

type OrderEntryWorkspaceProps = {
    identity: ReactNode;
    lineItems: ReactNode;
    fulfillment: ReactNode;
    summary: ReactNode;
    actions: ReactNode;
};

/** Creation follows the saved Order: identity, full-width lines, then utility sections. */
export function OrderEntryWorkspace({ identity, lineItems, fulfillment, summary, actions }: OrderEntryWorkspaceProps) {
    return (
        <div className="mt-4 min-w-0 space-y-4 [&_button]:scroll-mt-56 [&_input]:scroll-mt-56 [&_select]:scroll-mt-56 [&_textarea]:scroll-mt-56" data-testid="order-entry-workspace">
            {identity}
            <div className="sticky top-0 z-30 rounded-lg border border-border bg-card p-3 shadow-sm" data-testid="order-create-actions">
                {actions}
            </div>
            <section aria-label="Order line items" className="min-w-0">{lineItems}</section>
            <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(240px,0.75fr)_minmax(0,2fr)]" data-testid="order-utilities">
                <section aria-label="Order totals" className="min-w-0">{summary}</section>
                <section id="new-order-fulfillment" aria-label="Order fulfillment" className="min-w-0 scroll-mt-56">{fulfillment}</section>
            </div>
        </div>
    );
}
