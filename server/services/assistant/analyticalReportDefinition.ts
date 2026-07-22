import {
  analyticsFinancialSourceValues,
  reportDefinitionSchema,
  type ReportDefinition,
} from "@shared/aiReportingContracts";

export type AnalyticsFinancialSource = (typeof analyticsFinancialSourceValues)[number];

export interface CustomerAnalyticsReportProvenance {
  companyName: string;
  resolutionType: "company" | "contact";
  contactName?: string | null;
  explanation: string;
  dateRange: { start: string; end: string };
  financialSource: AnalyticsFinancialSource;
  timezone: string;
  dataSnapshotAt: string;
  sourceRecordCount: number;
}

const sourceLabels: Record<AnalyticsFinancialSource, string> = {
  posted_revenue: "Posted native invoice-line snapshots",
  order_value: "Qualifying order financial snapshots",
  combined_pipeline_view: "Posted invoices and uninvoiced order snapshots",
};

const sourceDefinitions: Record<AnalyticsFinancialSource, string> = {
  posted_revenue: "Posted revenue uses finalized native invoice-line snapshots. Draft, void, and imported invoice snapshots are excluded.",
  order_value: "Order value is operational value from qualifying order financial snapshots; it is not recognized revenue.",
  combined_pipeline_view: "Posted revenue and uninvoiced order value are shown separately. The combined pipeline is operational context, not recognized revenue.",
};

/**
 * The narrow Report Studio seam for assistant analytics. It creates only a
 * validated, serializable definition; route handlers remain responsible for
 * authorization and persistence. No tool result, account ID, or internal link
 * is embedded, so the definition can safely pass through customer-safe report
 * filtering while still preserving human-readable resolution provenance.
 */
export function createCustomerAnalyticsReportDefinition(input: CustomerAnalyticsReportProvenance & {
  title?: string;
  description?: string;
  sections: ReportDefinition["sections"];
}): ReportDefinition {
  const source = input.financialSource;
  if (!analyticsFinancialSourceValues.includes(source)) throw new Error("Unsupported analytical financial source.");
  const contactContext = input.resolutionType === "contact" && input.contactName
    ? `${input.contactName} was resolved to ${input.companyName}.`
    : `Analysis is for ${input.companyName}.`;
  return reportDefinitionSchema.parse({
    version: "v1",
    title: input.title?.trim() || `${input.companyName} analytics`,
    description: input.description?.trim() || contactContext,
    audience: "private",
    financialSource: source,
    timezone: input.timezone,
    dataSnapshotAt: input.dataSnapshotAt,
    // Deliberately human-readable, no account/contact IDs or source URLs.
    filters: {
      company: input.companyName,
      contactResolution: input.explanation,
      dateRange: input.dateRange,
      financialSource: source,
    },
    sources: [{ label: sourceLabels[source], count: Math.max(0, Math.trunc(input.sourceRecordCount)), freshness: input.dataSnapshotAt }],
    sections: [
      ...input.sections,
      { kind: "methodology", text: sourceDefinitions[source] },
    ],
  });
}
