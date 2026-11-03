import { InboundStatusDisclosure } from "./InboundStatusDisclosure";
import { inboundAccountabilityLabel, inboundIsPending, inboundLinkedOrderId, type InboundAccountabilityRecord } from "@shared/inboundAccountability";

export function InboundAccountabilityNotice({ record }: { record: InboundAccountabilityRecord }) {
  const orderId = inboundLinkedOrderId(record);
  if (!record.createdQuoteId && !orderId) return null;
  return <InboundStatusDisclosure
    preferenceKey="titanos.inboundOrders.linkedEvidenceExpanded"
    title="Linked evidence"
    summary={inboundAccountabilityLabel(record) ?? (orderId ? "Linked Order" : "Linked Quote")}
  >
    <div className="break-words">
      {record.createdQuoteId && <a className="mr-3 underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring" href={`/quotes/${encodeURIComponent(record.createdQuoteId)}`}>Open linked Quote</a>}
      {orderId && <a className="mr-3 underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring" href={`/orders/${encodeURIComponent(orderId)}`}>Open linked Order</a>}
      {inboundIsPending(record) && <span>{orderId
        ? "Review current evidence against this Order. Attach it deliberately or dismiss it. No Order changes or new Order creation happen automatically."
        : "Quote linkage alone does not resolve this request. Convert the Quote through the existing Order operation, or deliberately dismiss the request."}</span>}
    </div>
  </InboundStatusDisclosure>;
}
