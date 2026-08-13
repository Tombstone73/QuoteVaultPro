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
import { buildArtworkOutputSets } from "@shared/artworkAllocation";
import { loadTicketTemplate } from "@/lib/ticketSettings";
import { buildJobTicketQrUrl, ticketRowStyle, THERMAL_PRINT_STYLES } from "@/lib/ticketRender";
import {
  parseTicketOverrides,
  resolveQuantityDisplay,
  ticketReasonBanner,
} from "@/lib/ticketPrintOverrides";
import { useStationPrinter } from "@/hooks/useStationPrinter";
import { markPrinterProfileUsed } from "@/hooks/usePrinterProfiles";
import { PrinterPicker } from "@/components/production/PrinterPicker";
import {
  CenteredMessage,
  ThermalDivider,
  ThermalLabel,
  ThermalPrintPage,
  ThermalQrBlock,
  ThermalSection,
} from "@/components/production/ticketPrintPrimitives";
import { Printer, RotateCcw, ArrowLeft } from "lucide-react";
import { useOrgPreferences } from "@/hooks/useOrgPreferences";
import { getProductionOrderNumber } from "@/lib/productionDocumentNumbers";

/** Capitalize a station key for the Station / Route field (e.g. "flatbed" → "Flatbed"). */
function titleCase(value: string | null | undefined): string {
  const s = String(value || "").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
}

function artworkQuantityLabel(value: unknown) {
  const quantity = Number(value);
  return Number.isInteger(quantity) && quantity > 0 ? `QTY ${quantity}` : "QTY unresolved";
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
  const { preferences } = useOrgPreferences();
  const productionNumberDisplayMode = preferences.production?.documentNumberDisplayMode ?? "full";
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
            orderNumber: getProductionOrderNumber(data, productionNumberDisplayMode) || data.order.orderNumber,
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
    if (printer.profiles.length > 0 && !printer.selectedProfile) {
      window.alert("Select a printer profile before printing.");
      return;
    }
    if (printer.selectedProfile) void markPrinterProfileUsed(printer.selectedProfile.id);
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
    if (printer.profiles.length > 0 && !printer.selectedProfile) {
      window.alert("Select a printer profile before reprinting.");
      return;
    }
    reprint.mutate(undefined, {
      // Give the toast/query a tick to settle, then open the print dialog.
      onSuccess: () => {
        if (printer.selectedProfile) void markPrinterProfileUsed(printer.selectedProfile.id);
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

  const ticketArtwork = (data?.productionFiles?.length ? data.productionFiles : data?.artwork || []).map((art: any) => ({
    id: art.id,
    fileName: art.fileName || art.originalFilename || "Artwork",
    thumbnailUrl: art.thumbnailUrl || art.thumbUrl || null,
    productionQuantity: art.productionQuantity ?? art.allocatedQuantity ?? null,
    productionGroupId: art.productionGroupId ?? art.allocationGroupId ?? null,
    side: art.side || art.sourceArtworkSide || null,
  }));
  const ticketArtworkSets = buildArtworkOutputSets(ticketArtwork.map((art) => ({
    id: art.id,
    role: "final",
    productionQuantity: art.productionQuantity,
    productionGroupId: art.productionGroupId,
  }))).map((set) => ({
    ...set,
    artwork: set.memberIds.map((id) => ticketArtwork.find((art) => art.id === id)).filter(Boolean),
  }));

  return (
    <div className="min-h-screen bg-muted/40 print:bg-white">
      <style dangerouslySetInnerHTML={{ __html: THERMAL_PRINT_STYLES }} />

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
            <Button onClick={handlePrint} size="sm" className="gap-1.5" disabled={printer.profiles.length > 0 && !printer.selectedProfile}>
              <Printer className="h-4 w-4" /> Print Ticket
            </Button>
            {!isSample && (
              <Button
                onClick={handleReprint}
                size="sm"
                variant="secondary"
                disabled={reprint.isPending || (printer.profiles.length > 0 && !printer.selectedProfile)}
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
        <ThermalPrintPage>
          {reasonBanner && (
            <div
              style={{
                border: "2px solid #000",
                textAlign: "center",
                fontWeight: 900,
                fontSize: "18px",
                lineHeight: 1.05,
                padding: "1.5mm",
                marginBottom: "1mm",
              }}
            >
              {reasonBanner}
            </div>
          )}
          {ticket.rows.map((row) => (
            <div key={row.key}>
              {row.format.dividerBefore && <ThermalDivider />}
              <ThermalSection compact>
                {row.key !== "rush" && (
                  <ThermalLabel align={row.format.align}>{row.label}</ThermalLabel>
                )}
                <div style={ticketRowStyle(row.format)}>
                  {row.key === "rush" ? `★ ${row.value} ★` : row.value}
                </div>
              </ThermalSection>
              {row.format.dividerAfter && <ThermalDivider />}
            </div>
          ))}

          {/* ARTWORK THUMBNAIL — placeholder for future B&W thumbnail support.
              MVP does not block on thumbnail generation; if a thumbnail exists
              we show it desaturated, otherwise a labelled placeholder box. */}
          <ThermalDivider />
          <ThermalSection compact>
            <ThermalLabel>Artwork</ThermalLabel>
            {ticketArtworkSets.length > 0 ? (
              ticketArtworkSets.map((set, setIndex) => (
                <div key={set.id} style={{ marginTop: "1.5mm" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: "2mm", fontSize: "13px", fontWeight: 900, lineHeight: 1.1 }}>
                    <span>Artwork Set {setIndex + 1}{set.artwork.length > 1 ? ` · ${set.artwork.length} required layers` : ""}</span>
                    <span>{artworkQuantityLabel(set.quantity)}</span>
                  </div>
                  {set.artwork.map((art: any) => (
                    <div key={art.id} style={{ marginTop: "1mm" }}>
                      <div style={{ fontSize: "11px", fontWeight: 700, lineHeight: 1.1 }}>{art.fileName}</div>
                      {art.side ? (
                        <div style={{ fontSize: "10px", fontWeight: 700, lineHeight: 1.1 }}>
                          {String(art.side).toUpperCase()}
                        </div>
                      ) : null}
                      {art.thumbnailUrl ? (
                        <img
                          src={art.thumbnailUrl}
                          alt="Artwork preview"
                          style={{
                            width: "100%",
                            maxHeight: "40mm",
                            objectFit: "contain",
                            filter: "grayscale(1) contrast(1.15)",
                            border: "1.5px solid #000",
                            marginTop: "1mm",
                          }}
                        />
                      ) : null}
                    </div>
                  ))}
                </div>
              ))
            ) : (
              <div
                style={{
                  border: "1.5px dashed #000",
                  padding: "5mm 2mm",
                  textAlign: "center",
                  fontSize: "14px",
                  fontWeight: 900,
                  lineHeight: 1.1,
                  color: "#000",
                  marginTop: "1mm",
                }}
              >
                B&amp;W artwork thumbnail
                <br />
                coming soon
              </div>
            )}
          </ThermalSection>

          {/* QR CODE — links back to the job in TitanOS */}
          <ThermalDivider />
          <ThermalQrBlock
            qrDataUrl={qrDataUrl}
            alt="Job QR code"
            instruction="Scan to open job in Printers Hero"
            timestamp={`Printed ${new Date().toLocaleString()}`}
          >
            {ticket.reprintCount > 0 && (
              <div style={{ fontSize: "13px", fontWeight: 900, lineHeight: 1.1, marginTop: "1.5mm" }}>
                Reprints: {ticket.reprintCount}
              </div>
            )}
          </ThermalQrBlock>
        </ThermalPrintPage>
      </div>
    </div>
  );
}
