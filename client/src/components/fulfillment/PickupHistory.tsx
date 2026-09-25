import type { FulfillmentDetail } from "@/hooks/useFulfillment";
import type { PickupTravelerHistoryEntry } from "@shared/pickupTravelerProgress";

type Props = {
  detail: FulfillmentDetail;
  selectedTravelerIds: string[];
  onToggle: (id: string, selected: boolean) => void;
  onReprint: (traveler: PickupTravelerHistoryEntry) => void;
  onReverse: (handoff: FulfillmentDetail["pickupHandoffs"][number]) => void;
};

export function PickupHistory({ detail, selectedTravelerIds, onToggle, onReprint, onReverse }: Props) {
  const travelers = detail.pickupTravelers ?? [];
  const prepared = travelers.filter(t => !t.pickupHandoffId);
  const reprint = (t: PickupTravelerHistoryEntry) => <button key={t.id} type="button" className="rounded border px-3 py-2" onClick={() => onReprint(t)}>
    {t.id.startsWith("handoff:") ? "Print Traveler" : "Reprint Traveler"}{t.box ? ` · Box ${t.box.current} of ${t.box.total}` : ""}
  </button>;
  return <>
    {prepared.length > 0 && <section className="rounded-xl border bg-card p-4" data-testid="prepared-travelers">
      <h2 className="font-bold">Prepared Travelers</h2>
      <p className="text-sm text-muted-foreground">Select paperwork belonging to this pickup before completing it. Reprints keep the saved quantities.</p>
      {prepared.map(t => <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 border-t py-2 text-sm">
        <div><p>{new Date(t.createdAt).toLocaleString()}</p><p>{t.lines.map(l => `${l.quantity} ${l.description}`).join(" · ")}</p>
          {detail.fulfillmentType === "PICKUP" && detail.remainingQuantity > 0 && <label><input type="checkbox" checked={selectedTravelerIds.includes(t.id)} onChange={e => onToggle(t.id, e.target.checked)} /> Include in this pickup</label>}
        </div>{reprint(t)}
      </div>)}
    </section>}
    {detail.pickupHandoffs.length > 0 && <section className="rounded-xl border bg-card px-4 py-3" data-testid="pickup-history">
      <h2 className="font-bold">Pickup History</h2><div className="mt-2 divide-y">{detail.pickupHandoffs.map(handoff => {
        const saved = travelers.filter(t => t.pickupHandoffId === handoff.id);
        return <div key={handoff.id} className="py-3 text-sm">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div><p className="font-medium">{new Date(handoff.handedOffAt).toLocaleString()}</p>
              <strong className={handoff.status?.includes("REVERSED") ? "text-destructive" : ""}>{handoff.status === "REVERSED" ? "Reversed" : handoff.status === "PARTIALLY_REVERSED" ? "Partially reversed" : "Completed"}</strong>
            </div>
            {detail.permissions?.canReverseTerminalFulfillment && handoff.status !== "REVERSED" && <button type="button" className="rounded border border-destructive/40 px-2 py-1 text-xs font-semibold text-destructive" onClick={() => onReverse(handoff)}>Reverse Pickup</button>}
          </div>
          {handoff.items.map(item => <p key={item.orderLineItemId}>{item.quantity} {item.productName || item.description || "line item"}</p>)}
          {handoff.handedOffByName && <p className="text-muted-foreground">{handoff.handedOffByName}</p>}
          {handoff.notes && <p className="text-muted-foreground">{handoff.notes}</p>}
          {handoff.reversals?.map(reversal => <p key={reversal.id} className="mt-1 text-muted-foreground">
            Reversed{reversal.createdAt ? ` ${new Date(reversal.createdAt).toLocaleString()}` : ""}
            {reversal.actorName ? ` by ${reversal.actorName}` : reversal.actorUserId ? ` by staff ${reversal.actorUserId}` : ""}
            {reversal.reason ? ` — ${reversal.reason}` : ""}
          </p>)}
          {saved.length ? <div className="mt-2 flex flex-wrap gap-2">{saved.map(reprint)}</div>
            : <p className="text-xs text-muted-foreground">No saved Traveler associated with this pickup.</p>}
        </div>;
      })}</div>
    </section>}
  </>;
}
