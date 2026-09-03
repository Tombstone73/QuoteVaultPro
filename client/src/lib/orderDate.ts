import { orderBusinessDatePart, serializeOrderBusinessDate } from "@shared/orderBusinessDate";

export type OrderDateDisplayStyle = "short" | "numeric";

/** Keeps Order due/promised dates as calendar dates, independent of browser timezone. */
export function orderDateInputValue(value: string | Date | null | undefined): string {
  return orderBusinessDatePart(value) ?? "";
}

export function serializeOrderDateInput(value: string): string | null {
  return serializeOrderBusinessDate(value);
}

export function formatOrderDate(value: string | Date | null | undefined, style: OrderDateDisplayStyle): string {
  const datePart = orderBusinessDatePart(value);
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
