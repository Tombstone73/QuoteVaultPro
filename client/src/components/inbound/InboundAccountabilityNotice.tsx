import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { inboundAccountabilityLabel, inboundIsPending, inboundLinkedOrderId, type InboundAccountabilityRecord } from "@shared/inboundAccountability";

export function InboundAccountabilityNotice({ record }: { record: InboundAccountabilityRecord }) {
  const orderId = inboundLinkedOrderId(record);
  if (!record.createdQuoteId && !orderId) return null;
  return <Alert className="mt-3">
    <AlertTitle>{inboundAccountabilityLabel(record) ?? "Linked evidence"}</AlertTitle>
    <AlertDescription>
      {record.createdQuoteId && <a className="mr-3 underline" href={`/quotes/${encodeURIComponent(record.createdQuoteId)}`}>Open linked Quote</a>}
      {orderId && <a className="mr-3 underline" href={`/orders/${encodeURIComponent(orderId)}`}>Open linked Order</a>}
      {inboundIsPending(record) && <span>{orderId
        ? "Review current evidence against this Order. Attach it deliberately or dismiss it. No Order changes or new Order creation happen automatically."
        : "Quote linkage alone does not resolve this request. Convert the Quote through the existing Order operation, or deliberately dismiss the request."}</span>}
    </AlertDescription>
  </Alert>;
}
