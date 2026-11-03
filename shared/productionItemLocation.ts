export type ProductionItemLocation = {
  jobId: string; lineItemId: string; orderId: string; stationKey: string;
  stepKey: string; status: string; runId: string | null; prepress: boolean;
};

export const productionItemLink = (jobId: string) => `/production?jobId=${encodeURIComponent(jobId)}`;
export const prepressItemLink = (lineItemId: string) => `/production/prepress?lineItemId=${encodeURIComponent(lineItemId)}`;
export function productionItemBoardLink(item: ProductionItemLocation) {
  if (item.prepress) return prepressItemLink(item.lineItemId);
  const station = item.stationKey === "wide_roll" ? "roll" : item.stationKey;
  return ["roll", "flatbed"].includes(station) ? `/production/${station}?jobId=${encodeURIComponent(item.jobId)}` : null;
}
