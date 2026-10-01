import { V2ApplicationError } from "../../errors/applicationError.js";

export type ReportingWindowRequest = Readonly<{
  period: "today" | "month" | "custom";
  fromDate?: string;
  /** Inclusive local calendar date; persistence converts it to an exclusive boundary. */
  toDate?: string;
}>;
export type ReportingWindowInput = ReportingWindowRequest & Readonly<{ asOf?: Date }>;
export type ReportingWindow = Readonly<{
  asOf: string;
  timeZone: string;
  timeZoneSource: "organization" | "default_utc";
  startInclusive: string;
  endExclusive: string;
  todayDate: string;
  tomorrowDate: string;
}>;

/** Calendar validation only. UTC instant/DST boundaries are PostgreSQL's responsibility. */
export function validateReportingWindow(input: ReportingWindowRequest): void {
  if (!input || !["today", "month", "custom"].includes(input.period)) {
    throw new V2ApplicationError("VALIDATION_ERROR", "Choose Today, Month, or a Custom reporting period.");
  }
  if (input.period !== "custom") {
    if (input.fromDate !== undefined || input.toDate !== undefined) throw new V2ApplicationError("VALIDATION_ERROR", "Date bounds are only accepted for a Custom period.");
    return;
  }
  const date = (value: unknown): number => {
    if (typeof value !== "string" || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)) throw new V2ApplicationError("VALIDATION_ERROR", "Custom bounds must be valid YYYY-MM-DD dates.");
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new V2ApplicationError("VALIDATION_ERROR", "Custom bounds must be valid YYYY-MM-DD dates.");
    return parsed.getTime();
  };
  const span = (date(input.toDate) - date(input.fromDate)) / 86_400_000 + 1;
  if (span < 1 || span > 366) throw new V2ApplicationError("VALIDATION_ERROR", "A Custom reporting period must contain between one and 366 calendar days.");
}
