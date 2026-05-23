/**
 * Production Ticket — print-friendly thermal ticket page (MVP).
 *
 * Renders a narrow (~72mm) ticket suitable for an Epson TM-L90 ticket printer
 * using the standard browser/Windows print flow (window.print()). It does NOT
 * do direct ESC/POS socket printing — that is intentionally out of scope.
 *
 * The ticket layout is driven by a `TicketTemplate` (see shared/productionTicket)
 * so field visibility, order, labels and emphasis can later be controlled by a
 * visual template editor without changing this renderer.
 *
 * Print-snapshot overrides (from the Print Options modal) arrive as URL query
 * params and are applied for rendering only — they never mutate job/order data.
 */

import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import QRCode from "qrcode";

import { Button } from "@/components/ui/button";
import {
  logTicketPrint,
  useProductionJob,
  useReprintProductionJob,
  type TicketPrintReason,
} from "@/hooks/useProduction";
import { buildTicketData, type TicketSourceData } from "@shared/productionTicket";
import { loadTicketTemplate } from "@/lib/ticketSettings";
import { buildJobTicketQrUrl, ticketRowStyle, TICKET_PRINT_STYLES } from "@/lib/ticketRender";
import {
  parseTicketOverrides,
  resolveQuantityDisplay,
  ticketReasonBanner,
} from "@/lib/ticketPrintOverrides";
import { useStationPrinter } from "@/hooks/useStationPrinter";
import { PrinterPicker } from "@/components/production/PrinterPicker";
import { CenteredMessage, TicketDivider } from "@/components/production/ticketPrintPrimitives";
import { Printer, RotateCcw, ArrowLeft } from "lucide-react";

/** Capitalize a station key for the Station / Route field (e.g. "flatbed" → "Flatbed"). */
function titleCase(value: string | null | undefined): string {
  const s = String(value || "").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
}

/**
 * Mock ticket data for the station "Test Ticket" — lets each station confirm
 * its printer setup without touching a real production job.
 */
const SAMPLE_TICKET_SOURCE: TicketSourceData = {
  jobId: "sample",
  orderId: "sample",
  orderNumber: "SO-0000",
  poNumber: "PO-DEMO",
  customerName: "Sample Customer Co.",
  contactName: "Pat Sample",
  fulfillment: "Pickup",
  stationRoute: "Flatbed",
  dueDate: new Date().toISOString(),
  priority: "rush",
  description: "TEST TICKET — printer setup check",
  quantity: 1,
  size: "24 × 18",
  material: "4mm Coroplast",
  productionNotes: "This is a sample ticket. No production action required.",
  internalNotes: "Use this to verify the Epson TM-L90 alignment and darkness.",
  reprintCount: 0,
  stationKey: "test",
};

export default function ProductionTicketPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const [searchParams] = useSearchParams();
  const isSample = jobId === "sample";

  const overrides = useMemo(() => parseTicketOverrides(searchParams), [searchParams]);
  const reasonBanner = ticketReasonBanner(overrides.reason);

  const { data, isLoading, error } = useProductionJob(isSample ? undefined : jobId);
  const reprint = useReprintProductionJob(jobId || "");

  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const printer = useStationPrinter();
  const template = useMemo(() => loadTicketTemplate(), []);

  // Build the link the QR code points back to (job in TitanOS).
  const jobUrl = useMemo(() => {
    if (!jobId) return "";
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    return buildJobTicketQrUrl(origin, jobId);
  }, [jobId]);

  useEffect(() => {
    if (!jobUrl) return;
    let cancelled = false;
    QRCode.toDataURL(jobUrl, { margin: 1, width: 200, errorCorrectionLevel: "M" })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [jobUrl]);

  // Map the production job detail into the ticket source shape, applying any
  // print-snapshot overrides (render-only — backend data is untouched).
  const ticket = useMemo(() => {
    const base = isSample
      ? SAMPLE_TICKET_SOURCE
      : data
        ? ({
            jobId: data.id,
            orderId: data.order.id,
            orderNumber: data.order.orderNumber,
            poNumber: data.poNumber ?? data.order.poNumber ?? null,
            customerName: data.order.customerName,
            contactName: data.contactName ?? data.order.contactName ?? null,
            fulfillment: data.fulfillment ?? data.order.fulfillment ?? null,
            stationRoute: titleCase(data.stationKey) || null,
            assignedTo: data.assignedTo ?? null,
            dueDate: data.order.dueDate ?? null,
            priority: data.order.priority ?? null,
            description: data.jobDescription || "",
            quantity: data.qty ?? 0,
            size: data.size ?? null,
            material: data.media ?? null,
            productionNotes:
              data.productionNotes ?? data.order.lineItems?.primary?.productionNotes ?? null,
            internalNotes: data.internalNotes ?? data.order.internalNotes ?? null,
            reprintCount: data.reprintCount ?? 0,
            stationKey: data.stationKey ?? null,
          } satisfies TicketSourceData)
        : null;
    if (!base) return null;

    const src: TicketSourceData = {
      ...base,
      // Print-snapshot overrides from the Print Options modal.
      fulfillment: overrides.fulfillment || base.fulfillment,
      stationRoute: overrides.stationRoute || base.stationRoute,
      ticketNote: overrides.note || null,
      quantityDisplay:
        overrides.quantityMode === "partial"
          ? resolveQuantityDisplay(overrides, base.quantity)
          : null,
    };
    return buildTicketData(src, template);
  }, [data, template, isSample, overrides]);

  /** Snapshot metadata for the print-history log. */
  function buildLogMeta(reason: TicketPrintReason) {
    return {
      reason,
      destination: overrides.destination ?? null,
      quantityDisplay:
        overrides.quantityMode === "partial" && data
          ? resolveQuantityDisplay(overrides, data.qty ?? 0)
          : null,
      fulfillment: overrides.fulfillment ?? null,
      route: overrides.stationRoute ?? null,
      note: overrides.note ?? null,
    };
  }

  function handlePrint() {
    window.print();
    // Best-effort print-history logging (skipped for the sample ticket).
    if (!isSample && jobId) {
      const reason: TicketPrintReason =
        overrides.reason === "standard" ? "standard" : overrides.reason;
      void logTicketPrint(jobId, buildLogMeta(reason));
    }
  }

  function handleReprint() {
    if (reprint.isPending) return;
    reprint.mutate(undefined, {
      // Give the toast/query a tick to settle, then open the print dialog.
      onSuccess: () => {
        if (jobId) void logTicketPrint(jobId, buildLogMeta("reprint"));
        window.setTimeout(() => window.print(), 150);
      },
    });
  }

  if (!isSample && isLoading) {
    return <CenteredMessage>Loading ticket…</CenteredMessage>;
  }
  if (!ticket || (!isSample && (error || !data))) {
    return <CenteredMessage>Failed to load production job ticket.</CenteredMessage>;
  }

  const artwork = (data?.artwork || [])[0] ?? null;

  return (
    <div className="min-h-screen bg-muted/40 print:bg-white">
      <style dangerouslySetInnerHTML={{ __html: TICKET_PRINT_STYLES }} />

      {/* TOOLBAR — never printed */}
      <div className="ticket-no-print sticky top-0 z-10 border-b bg-background">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-3 px-4 py-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => window.history.back()}
            className="gap-1.5"
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>

          {isSample && (
            <span className="rounded bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-800">
              Test Ticket — printer setup check
            </span>
          )}
          {!isSample && overrides.reason !== "standard" && (
            <span className="rounded bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700 capitalize">
              {overrides.reason} ticket
            </span>
          )}

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button onClick={handlePrint} size="sm" className="gap-1.5">
              <Printer className="h-4 w-4" /> Print Ticket
            </Button>
            {!isSample && (
              <Button
                onClick={handleReprint}
                size="sm"
                variant="secondary"
                disabled={reprint.isPending}
                className="gap-1.5"
              >
                <RotateCcw className="h-4 w-4" /> Reprint
              </Button>
            )}
          </div>
        </div>

        {/* Printer selection — guides the operator to the right printer in the
            browser print dialog (MVP does not print silently). */}
        <div className="mx-auto max-w-3xl px-4 pb-3">
          <PrinterPicker printer={printer} />
          {overrides.destination && (
            <div className="mt-1 text-xs text-muted-foreground">
              Print Options destination: <strong>{overrides.destination}</strong>
            </div>
          )}
        </div>
      </div>

      {/* TICKET — the only printable area */}
      <div className="mx-auto max-w-md px-4 py-6">
        <div
          id="ticket-print-area"
          className="mx-auto bg-white text-black"
          style={{ width: "72mm", padding: "4mm", fontFamily: "Arial, Helvetica, sans-serif" }}
        >
          {reasonBanner && (
            <div
              style={{
                border: "2px solid #000",
                textAlign: "center",
                fontWeight: 700,
                fontSize: "14px",
                padding: "1.5mm",
                marginBottom: "1.5mm",
              }}
            >
              {reasonBanner}
            </div>
          )}
          {ticket.rows.map((row) => (
            <div key={row.key}>
              {row.format.dividerBefore && <TicketDivider />}
              <div style={{ margin: "1.5mm 0" }}>
                {row.key !== "rush" && (
                  <div
                    style={{
                      fontSize: "8px",
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                      color: "#444",
                      textAlign: row.format.align,
                    }}
                  >
                    {row.label}
                  </div>
                )}
                <div style={ticketRowStyle(row.format)}>
                  {row.key === "rush" ? `★ ${row.value} ★` : row.value}
                </div>
              </div>
              {row.format.dividerAfter && <TicketDivider />}
            </div>
          ))}

          {/* ARTWORK THUMBNAIL — placeholder for future B&W thumbnail support.
              MVP does not block on thumbnail generation; if a thumbnail exists
              we show it desaturated, otherwise a labelled placeholder box. */}
          <TicketDivider />
          <div style={{ margin: "1.5mm 0" }}>
            <div
              style={{
                fontSize: "8px",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                color: "#444",
              }}
            >
              Artwork
            </div>
            {artwork?.thumbnailUrl ? (
              <img
                src={artwork.thumbnailUrl}
                alt="Artwork preview"
                style={{
                  width: "100%",
                  maxHeight: "40mm",
                  objectFit: "contain",
                  filter: "grayscale(1) contrast(1.15)",
                }}
              />
            ) : (
              <div
                style={{
                  border: "1px dashed #999",
                  padding: "6mm 2mm",
                  textAlign: "center",
                  fontSize: "9px",
                  color: "#666",
                }}
              >
                B&amp;W artwork thumbnail
                <br />
                (coming soon)
              </div>
            )}
          </div>

          {/* QR CODE — links back to the job in TitanOS */}
          <TicketDivider />
          <div style={{ textAlign: "center", margin: "2mm 0 0" }}>
            {qrDataUrl ? (
              <img
                src={qrDataUrl}
                alt="Job QR code"
                style={{ width: "26mm", height: "26mm" }}
              />
            ) : (
              <div style={{ fontSize: "9px", color: "#666" }}>QR unavailable</div>
            )}
            <div style={{ fontSize: "8px", color: "#444", marginTop: "1mm" }}>
              Scan to open job in Printers Hero
            </div>
            {ticket.reprintCount > 0 && (
              <div style={{ fontSize: "8px", color: "#444", marginTop: "1mm" }}>
                Reprints: {ticket.reprintCount}
              </div>
            )}
            <div style={{ fontSize: "7px", color: "#888", marginTop: "1mm" }}>
              Printed {new Date().toLocaleString()}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
