import { z } from "zod";

/** A calendar date, without an invented time of day. */
export const effectivePickupDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "Enter a valid pickup date").refine((value) => {
  // Permit a one-day timezone difference between the operator and server.
  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  return value <= tomorrow.toISOString().slice(0, 10);
}, "Pickup date is too far in the future");

export function currentLocalPickupDate(now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function displayPickupDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" })
    .format(new Date(`${value}T00:00:00.000Z`));
}
