export type OrderDateDisplayStyle = "short" | "numeric";

function datePartFromOrderDate(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : null;
}

/** Keeps Order due/promised dates as calendar dates, independent of browser timezone. */
export function orderDateInputValue(value: string | Date | null | undefined): string {
  return datePartFromOrderDate(value) ?? "";
}

export function serializeOrderDateInput(value: string): string | null {
  const datePart = value.trim();
  if (!datePart) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return null;
  const date = new Date(`${datePart}T12:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === datePart
    ? date.toISOString()
    : null;
}

export function formatOrderDate(value: string | Date | null | undefined, style: OrderDateDisplayStyle): string {
  const datePart = datePartFromOrderDate(value);
  if (!datePart) return "—";
  const date = new Date(`${datePart}T00:00:00.000Z`);
  if (style === "short") {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    }).format(date);
  }
  return `${datePart.slice(5, 7)}/${datePart.slice(8, 10)}/${datePart.slice(0, 4)}`;
}
