export type OrderArtworkSide = "front" | "back" | "both";

export async function assignOrderLineItemArtworkSide(input: {
  orderId: string;
  lineItemId: string;
  fileId: string;
  side: OrderArtworkSide;
  fetchImpl?: typeof fetch;
}): Promise<unknown> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl(
    `/api/orders/${encodeURIComponent(input.orderId)}/line-items/${encodeURIComponent(input.lineItemId)}/files/${encodeURIComponent(input.fileId)}/artwork-side`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ side: input.side }),
      credentials: "include",
    },
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error || "Could not update artwork side");
  }
  return payload?.data;
}
