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
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import QRCode from "qrcode";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useProductionJob, useReprintProductionJob } from "@/hooks/useProduction";
import { buildTicketData, type TicketSourceData } from "@shared/productionTicket";
import {
  loadPrinterPrefs,
  loadTicketTemplate,
  savePrinterPrefs,
  type TicketPrinterPrefs,
} from "@/lib/ticketSettings";
import { buildJobTicketQrUrl, ticketRowStyle } from "@/lib/ticketRender";
import { Printer, RotateCcw, ArrowLeft } from "lucide-react";

/** Print-only stylesheet: isolates the ticket and sizes it for the TM-L90. */
const PRINT_STYLES = `
@media print {
  body * { visibility: hidden !important; }
  #ticket-print-area, #ticket-print-area * { visibility: visible !important; }
  #ticket-print-area {
    position: absolute; left: 0; top: 0;
    width: 72mm; margin: 0; padding: 0;
  }
  .ticket-no-print { display: none !important; }
  @page { size: 72mm auto; margin: 3mm; }
}
`;

export default function ProductionTicketPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const { data, isLoading, error } = useProductionJob(jobId);
  const reprint = useReprintProductionJob(jobId || "");

  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [printerPrefs, setPrinterPrefs] = useState<TicketPrinterPrefs>(() => loadPrinterPrefs());
  const [selectedPrinter, setSelectedPrinter] = useState<string>("");
  const [newPrinter, setNewPrinter] = useState("");
  const template = useMemo(() => loadTicketTemplate(), []);
  const lastReprintCount = useRef<number | null>(null);

  // Default the "Print To" selector to the station's saved default printer.
  useEffect(() => {
    if (!selectedPrinter && printerPrefs.defaultPrinter) {
      setSelectedPrinter(printerPrefs.defaultPrinter);
    }
  }, [printerPrefs.defaultPrinter, selectedPrinter]);

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

  // Map the production job detail into the ticket source shape.
  const ticket = useMemo(() => {
    if (!data) return null;
    const src: TicketSourceData = {
      jobId: data.id,
      orderId: data.order.id,
      orderNumber: data.order.orderNumber,
      customerName: data.order.customerName,
      contactName: data.contactName ?? data.order.contactName ?? null,
      assignedTo: data.assignedTo ?? null,
      dueDate: data.order.dueDate ?? null,
      priority: data.order.priority ?? null,
      description: data.jobDescription || "",
      quantity: data.qty ?? 0,
      size: data.size ?? null,
      material: data.media ?? null,
      productionNotes: data.productionNotes ?? data.order.lineItems?.primary?.productionNotes ?? null,
      internalNotes: data.internalNotes ?? data.order.internalNotes ?? null,
      reprintCount: data.reprintCount ?? 0,
      stationKey: data.stationKey ?? null,
    };
    return buildTicketData(src, template);
  }, [data, template]);

  function handleSavePrinter() {
    const name = newPrinter.trim();
    if (!name) return;
    const printers = printerPrefs.printers.includes(name)
      ? printerPrefs.printers
      : [...printerPrefs.printers, name];
    const next: TicketPrinterPrefs = { printers, defaultPrinter: name };
    setPrinterPrefs(next);
    savePrinterPrefs(next);
    setSelectedPrinter(name);
    setNewPrinter("");
  }

  function handleSelectPrinter(name: string) {
    setSelectedPrinter(name);
    // Selecting a printer also makes it this station's default.
    const next: TicketPrinterPrefs = { ...printerPrefs, defaultPrinter: name };
    setPrinterPrefs(next);
    savePrinterPrefs(next);
  }

  function handlePrint() {
    window.print();
  }

  function handleReprint() {
    if (reprint.isPending) return;
    lastReprintCount.current = ticket?.reprintCount ?? null;
    reprint.mutate(undefined, {
      // Give the toast/query a tick to settle, then open the print dialog.
      onSuccess: () => window.setTimeout(() => window.print(), 150),
    });
  }

  if (isLoading) {
    return <CenteredMessage>Loading ticket…</CenteredMessage>;
  }
  if (error || !data || !ticket) {
    return <CenteredMessage>Failed to load production job ticket.</CenteredMessage>;
  }

  const artwork = (data.artwork || [])[0] ?? null;

  return (
    <div className="min-h-screen bg-muted/40 print:bg-white">
      <style dangerouslySetInnerHTML={{ __html: PRINT_STYLES }} />

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

          <div className="ml-auto flex flex-wrap items-center gap-2">
            {/* Print To selector — guides the operator to the right printer in
                the browser print dialog (MVP does not print silently). */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">Print To:</span>
              <Select
                value={selectedPrinter || undefined}
                onValueChange={handleSelectPrinter}
              >
                <SelectTrigger className="h-8 w-[180px] text-xs">
                  <SelectValue placeholder="Choose printer…" />
                </SelectTrigger>
                <SelectContent>
                  {printerPrefs.printers.length === 0 ? (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">
                      No saved printers
                    </div>
                  ) : (
                    printerPrefs.printers.map((p) => (
                      <SelectItem key={p} value={p} className="text-xs">
                        {p}
                        {p === printerPrefs.defaultPrinter ? "  (default)" : ""}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>

            <Button onClick={handlePrint} size="sm" className="gap-1.5">
              <Printer className="h-4 w-4" /> Print Ticket
            </Button>
            <Button
              onClick={handleReprint}
              size="sm"
              variant="secondary"
              disabled={reprint.isPending}
              className="gap-1.5"
            >
              <RotateCcw className="h-4 w-4" /> Reprint
            </Button>
          </div>
        </div>

        {/* Add-printer row */}
        <div className="mx-auto flex max-w-3xl items-center gap-2 px-4 pb-3">
          <Input
            value={newPrinter}
            onChange={(e) => setNewPrinter(e.target.value)}
            placeholder="Add a printer name (e.g. Epson TM-L90)…"
            className="h-8 max-w-xs text-xs"
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSavePrinter();
            }}
          />
          <Button
            onClick={handleSavePrinter}
            size="sm"
            variant="outline"
            disabled={!newPrinter.trim()}
          >
            Save Printer
          </Button>
          {selectedPrinter && (
            <span className="text-xs text-muted-foreground">
              Select <strong>{selectedPrinter}</strong> in the print dialog.
            </span>
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
              Scan to open job in TitanOS
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

function TicketDivider() {
  return <div style={{ borderTop: "1px dashed #000", margin: "1.5mm 0" }} />;
}

function CenteredMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center p-6 text-sm text-muted-foreground">
      {children}
    </div>
  );
}
