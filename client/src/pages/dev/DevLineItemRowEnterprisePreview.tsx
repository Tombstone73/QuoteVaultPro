import * as React from "react";

import { useOrder } from "@/hooks/useOrders";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Page, ContentLayout, DataCard } from "@/components/titan";

import LineItemRowEnterprise, {
  LineItemEnterprisePanel,
  LineItemEnterpriseRowModel,
} from "@/components/line-items/LineItemRowEnterprise";

function parseMoney(value: string | null | undefined): number | null {
  if (!value) return null;
  const n = Number.parseFloat(String(value));
  return Number.isFinite(n) ? n : null;
}

function statusToneFromStatus(status: string | null | undefined): LineItemEnterpriseRowModel["statusTone"] {
  const s = (status ?? "").toLowerCase();
  if (!s) return "neutral";
  if (s.includes("done") || s.includes("complete") || s.includes("ready")) return "green";
  if (s.includes("production") || s.includes("progress") || s.includes("printing")) return "blue";
  if (s.includes("pending") || s.includes("proof") || s.includes("waiting")) return "purple";
  return "neutral";
}

export default function DevLineItemRowEnterprisePreview() {
  const [orderIdInput, setOrderIdInput] = React.useState("");
  const [loadedOrderId, setLoadedOrderId] = React.useState<string | undefined>(undefined);

  const {
    data: order,
    isLoading,
    error,
  } = useOrder(loadedOrderId);

  const lineItems = Array.isArray(order?.lineItems) ? order!.lineItems : [];

  return (
    <Page>
      <ContentLayout>
        <DataCard>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <div className="text-sm font-semibold">Dev: LineItemRowEnterprise Preview</div>
              <div className="text-xs text-muted-foreground">
                Enter an Order ID to preview line items.
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
              <Input
                value={orderIdInput}
                onChange={(e) => setOrderIdInput(e.target.value)}
                placeholder="Order ID"
              />
              <Button
                type="button"
                onClick={() => {
                  const trimmed = orderIdInput.trim();
                  setLoadedOrderId(trimmed ? trimmed : undefined);
                }}
              >
                Load
              </Button>
            </div>

            {!loadedOrderId ? (
              <div className="text-sm text-muted-foreground">Enter an Order ID to preview line items.</div>
            ) : null}

            {loadedOrderId && isLoading ? (
              <div className="text-sm">Loading order…</div>
            ) : null}

            {loadedOrderId && !isLoading && error ? (
              <div className="text-sm text-destructive">{String((error as any)?.message ?? error)}</div>
            ) : null}

            {loadedOrderId && !isLoading && order ? (
              <div className="flex flex-col gap-3">
                <div className="text-sm text-muted-foreground">
                  Order {order.orderNumber} • {lineItems.length} line items
                </div>

                <LineItemEnterprisePanel>
                  {lineItems.map((li: any) => {
                    const productName = li?.product?.name ?? null;
                    const variantName = li?.productVariant?.name ?? null;
                    const width = li?.width ?? null;
                    const height = li?.height ?? null;

                    const subtitleParts = [
                      variantName,
                      width && height ? `${width}x${height}` : null,
                    ].filter(Boolean);

                    const model: LineItemEnterpriseRowModel = {
                      id: String(li?.id ?? ""),
                      title: productName ?? li?.description ?? null,
                      subtitle: subtitleParts.length ? subtitleParts.join(" • ") : null,
                      optionsSummary: null,
                      flags: [],
                      notes: (li?.specsJson as any)?.lineItemNotes?.descLong ?? "",
                      statusLabel: li?.status ?? null,
                      statusTone: statusToneFromStatus(li?.status),
                      alertText: null,
                      qty: typeof li?.quantity === "number" ? li.quantity : null,
                      unitPrice: parseMoney(li?.unitPrice),
                      total: parseMoney(li?.totalPrice),
                      isOverride: null,
                    };

                    return (
                      <LineItemRowEnterprise
                        key={model.id}
                        item={model}
                        onDescriptionCommit={(itemId, nextDescription) => {
                          console.log("Description commit", { orderId: loadedOrderId, itemId, nextDescription });
                        }}
                        onNotesClick={(itemId) => {
                          console.log("Notes click", { orderId: loadedOrderId, itemId });
                        }}
                        onQtyChange={(itemId, nextQty) => {
                          console.log("Qty change", { orderId: loadedOrderId, itemId, nextQty });
                        }}
                        onOverrideChange={(itemId, nextChecked) => {
                          console.log("Override change", { orderId: loadedOrderId, itemId, nextChecked });
                        }}
                        statusOptions={[
                          { value: "queued", label: "Queued" },
                          { value: "printing", label: "Printing" },
                          { value: "finishing", label: "Finishing" },
                          { value: "done", label: "Done" },
                          { value: "canceled", label: "Canceled" },
                        ]}
                        onStatusChange={(itemId, nextStatus) => {
                          console.log("Status change", { orderId: loadedOrderId, itemId, nextStatus });
                        }}
                        onDuplicate={(itemId) => {
                          console.log("Duplicate", { orderId: loadedOrderId, itemId });
                        }}
                        onDelete={(itemId) => {
                          console.log("Delete", { orderId: loadedOrderId, itemId });
                        }}
                      />
                    );
                  })}

                  {lineItems.length === 0 ? (
                    <div className="text-sm text-muted-foreground p-3">No line items found for this order.</div>
                  ) : null}
                </LineItemEnterprisePanel>
              </div>
            ) : null}
          </div>
        </DataCard>
      </ContentLayout>
    </Page>
  );
}
