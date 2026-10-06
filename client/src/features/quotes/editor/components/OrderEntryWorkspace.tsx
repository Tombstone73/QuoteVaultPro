import type { ReactNode } from "react";

type OrderEntryWorkspaceProps = {
    identity: ReactNode;
    lineItems: ReactNode;
    settings: ReactNode;
    summary: ReactNode;
};

/** Order-only composition. The rail stretches with the lines so its summary can stick in-column. */
export function OrderEntryWorkspace({ identity, lineItems, settings, summary }: OrderEntryWorkspaceProps) {
    return (
        <div className="mt-4 min-w-0 space-y-4" data-testid="order-entry-workspace">
            {identity}
            <div className="grid min-w-0 items-stretch gap-4 lg:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[minmax(0,1fr)_344px]">
                <section aria-label="Order line items" className="min-w-0">{lineItems}</section>
                <aside aria-label="Order settings and summary" className="min-w-0 space-y-4">
                    {settings}
                    <div className="lg:sticky lg:top-4" data-testid="order-sticky-summary">{summary}</div>
                </aside>
            </div>
        </div>
    );
}
