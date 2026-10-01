import type { PoolClient } from "pg";
import { V2ApplicationError } from "../../src/errors/applicationError.js";
import { validateReportingWindow, type ReportingWindow, type ReportingWindowInput } from "../../src/modules/shared/reportingWindow.js";

/** Reads the actual Settings-owned timezone, never a browser or process timezone. */
export async function readReportingWindow(client: Pick<PoolClient, "query">, organizationId: string, input: ReportingWindowInput): Promise<ReportingWindow> {
  validateReportingWindow(input);
  const asOf = input.asOf ?? new Date();
  if (!(asOf instanceof Date) || !Number.isFinite(asOf.getTime())) throw new V2ApplicationError("VALIDATION_ERROR", "The internal reporting clock is invalid.");
  const organization = await client.query<{ timezone: string | null }>("SELECT settings->>'timezone' timezone FROM organizations WHERE id=$1", [organizationId]);
  if (!organization.rows[0]) throw new V2ApplicationError("NOT_FOUND", "Reporting organization was not found.");
  const configured = organization.rows[0].timezone;
  const timeZone = configured === null ? "UTC" : configured;
  const zone = await client.query<{ valid: boolean }>("SELECT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=$1) valid", [timeZone]);
  if (!zone.rows[0]?.valid) throw new V2ApplicationError("CONFLICT", "The configured organization reporting timezone is invalid. Correct it in Settings.");
  const result = await client.query<{ start_inclusive: Date; end_exclusive: Date; today_date: string; tomorrow_date: string; dates_valid: boolean }>(`
    WITH local_clock AS (SELECT $2::timestamptz AT TIME ZONE $1 AS local_now), boundaries AS (
      SELECT CASE $3::text
        WHEN 'today' THEN date_trunc('day',local_now)
        WHEN 'month' THEN date_trunc('month',local_now)
        ELSE $4::text::date::timestamp END AS local_start,
        CASE $3::text
        WHEN 'today' THEN date_trunc('day',local_now)+interval '1 day'
        WHEN 'month' THEN date_trunc('month',local_now)+interval '1 month'
        ELSE ($5::text::date+1)::timestamp END AS local_end, local_now
      FROM local_clock
    ) SELECT local_start AT TIME ZONE $1 AS start_inclusive, local_end AT TIME ZONE $1 AS end_exclusive,
      to_char(local_now::date,'YYYY-MM-DD') AS today_date,
      to_char(local_now::date+1,'YYYY-MM-DD') AS tomorrow_date,
      ($3::text<>'custom' OR (to_char($4::text::date,'YYYY-MM-DD')=$4::text AND to_char($5::text::date,'YYYY-MM-DD')=$5::text)) AS dates_valid
    FROM boundaries`, [timeZone, asOf.toISOString(), input.period, input.fromDate ?? null, input.toDate ?? null]);
  const row = result.rows[0]!;
  if (!row.dates_valid) throw new V2ApplicationError("VALIDATION_ERROR", "Custom reporting dates did not roundtrip.");
  return { asOf: asOf.toISOString(), timeZone, timeZoneSource: configured === null ? "default_utc" : "organization", startInclusive: row.start_inclusive.toISOString(), endExclusive: row.end_exclusive.toISOString(), todayDate: row.today_date, tomorrowDate: row.tomorrow_date };
}
