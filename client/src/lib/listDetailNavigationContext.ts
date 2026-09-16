export type ListNavigationEntity = "invoice" | "order";

export type ListDetailContext = {
  source: string;
  index: number;
};

const allowedSourcePath: Record<ListNavigationEntity, string> = {
  invoice: "/invoices",
  order: "/orders",
};

function validIndex(value: string | null): number | null {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

/** The source is an internal list URL, never an arbitrary redirect destination. */
export function parseListDetailContext(
  entity: ListNavigationEntity,
  params: URLSearchParams,
): ListDetailContext | null {
  const source = params.get("listSource");
  const index = validIndex(params.get("listIndex"));
  if (!source || index == null) return null;
  try {
    const url = new URL(source, window.location.origin);
    if (url.origin !== window.location.origin || url.pathname !== allowedSourcePath[entity]) return null;
    return { source: `${url.pathname}${url.search}`, index };
  } catch {
    return null;
  }
}

export function buildListDetailPath(
  entity: ListNavigationEntity,
  recordId: string,
  source: string,
  index: number,
): string {
  const params = new URLSearchParams({ listSource: source, listIndex: String(Math.max(0, index)) });
  return `${allowedSourcePath[entity]}/${recordId}?${params.toString()}`;
}
