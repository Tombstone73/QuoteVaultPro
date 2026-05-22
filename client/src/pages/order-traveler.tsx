/**
 * Order Traveler — print-friendly whole-order summary (MVP).
 *
 * A second mode of the shared ticket-printing framework: instead of a single
 * production job/line item, this prints an order-level "traveler" listing every
 * line item. Uses the standard browser/Windows print flow (window.print()) —
 * no direct ESC/POS printing.
 *
 * Reuses the shared ticket template (for the order-level header), the station
 * printer picker, the print stylesheet, and the print primitives.
 */

import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import QRCode from "qrcode";

import { Button } from "@/components/ui/button";
import { logTravelerPrint } from "@/hooks/useProduction";
import {
  buildOrderTravelerData,
  type OrderTravelerSource,
} from "@shared/productionTicket";
import { loadTicketTemplate } from "@/lib/ticketSettings";
import { ticketRowStyle, TICKET_PRINT_STYLES } from "@/lib/ticketRender";
import { useStationPrinter } from "@/hooks/useStationPrinter";
import { PrinterPicker } from "@/components/production/PrinterPicker";
import { CenteredMessage, TicketDivider } from "@/components/production/ticketPrintPrimitives";
import { Printer, ArrowLeft } from "lucide-react";

function useOrderTraveler(orderId: string | undefined) {
  return useQuery<OrderTravelerSource>({
    queryKey: ["/api/orders", orderId, "traveler"],
    queryFn: async () => {
      const res = await fetch(`/api/orders/${orderId}/traveler`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load order traveler");
      const json = await res.json();
      return json.data as OrderTravelerSource;
    },
    enabled: !!orderId,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}

export default function OrderTravelerPage() {
  const { orderId } = useParams<{ orderId: string }>();
  const { data, isLoading, error } = useOrderTraveler(orderId);

  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const printer = useStationPrinter();
  const template = useMemo(() => loadTicketTemplate(), []);

  const orderUrl = useMemo(() => {
    if (!orderId) return "";
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    return `${origin.replace(/\/+$/, "")}/orders/${orderId}`;
  }, [orderId]);

  useEffect(() => {
    if (!orderUrl) return;
    let cancelled = false;
    QRCode.toDataURL(orderUrl, { margin: 1, width: 200, errorCorrectionLevel: "M" })
      .then((url) => !cancelled && setQrDataUrl(url))
      .catch(() => !cancelled && setQrDataUrl(null));
    return () => {
      cancelled = true;
    };
  }, [orderUrl]);

  const traveler = useMemo(() => {
    if (!data) return null;
    return buildOrderTravelerData(data, template);
  }, [data, template]);

  function handlePrint() {
    window.print();
    if (orderId) void logTravelerPrint(orderId);
  }

  if (isLoading) return <CenteredMessage>Loading order traveler…</CenteredMessage>;
  if (error || !data || !traveler) {
    return <CenteredMessage>Failed to load order traveler.</CenteredMessage>;
  }

  return (
    <div className="min-h-screen bg-muted/40 print:bg-white">
      <style dangerouslySetInnerHTML={{ __html: TICKET_PRINT_STYLES }} />

      {/* TOOLBAR — never printed */}
      <div className="ticket-no-print sticky top-0 z-10 border-b bg-background">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-3 px-4 py-3">
          <Button variant="ghost" size="sm" onClick={() => window.history.back()} className="gap-1.5">
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
          <span className="rounded bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">
            Order Traveler
          </span>
          <div className="ml-auto">
            <Button onClick={handlePrint} size="sm" className="gap-1.5">
              <Printer className="h-4 w-4" /> Print Traveler
            </Button>
          </div>
        </div>
        <div className="mx-auto max-w-3xl px-4 pb-3">
          <PrinterPicker printer={printer} />
        </div>
      </div>

      {/* TRAVELER — the only printable area */}
      <div className="mx-auto max-w-md px-4 py-6">
        <div
          id="ticket-print-area"
          className="mx-auto bg-white text-black"
          style={{ width: "72mm", padding: "4mm", fontFamily: "Arial, Helvetica, sans-serif" }}
        >
          <div
            style={{
              textAlign: "center",
              fontSize: "9px",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: "#444",
              marginBottom: "1mm",
            }}
          >
            Order Traveler
          </div>

          {/* Order-level header — reuses the shared ticket template formatting */}
          {traveler.headerRows.map((row) => (
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

          {/* Line items */}
          <TicketDivider />
          <div
            style={{
              fontSize: "8px",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              color: "#444",
            }}
          >
            Line Items ({traveler.lineItemCount}) · Total Qty {traveler.totalQuantity}
          </div>
          {traveler.lineItems.length === 0 ? (
            <div style={{ fontSize: "10px", color: "#666", margin: "1.5mm 0" }}>
              No line items on this order.
            </div>
          ) : (
            traveler.lineItems.map((li) => (
              <div
                key={li.index}
                style={{ borderTop: "1px solid #ccc", padding: "1.5mm 0", fontSize: "10px" }}
              >
                <div style={{ fontWeight: 700, fontSize: "11px" }}>
                  {li.index}. {li.description}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: "0.5mm" }}>
                  <span>Qty: <strong>{li.quantity}</strong></span>
                  <span>{li.size}</span>
                </div>
                <div style={{ color: "#333" }}>Material: {li.material}</div>
                {li.productionNotes && (
                  <div style={{ color: "#333", marginTop: "0.5mm" }}>
                    Notes: {li.productionNotes}
                  </div>
                )}
              </div>
            ))
          )}

          {/* QR CODE — links back to the order in TitanOS */}
          <TicketDivider />
          <div style={{ textAlign: "center", margin: "2mm 0 0" }}>
            {qrDataUrl ? (
              <img src={qrDataUrl} alt="Order QR code" style={{ width: "26mm", height: "26mm" }} />
            ) : (
              <div style={{ fontSize: "9px", color: "#666" }}>QR unavailable</div>
            )}
            <div style={{ fontSize: "8px", color: "#444", marginTop: "1mm" }}>
              Scan to open order in TitanOS
            </div>
            <div style={{ fontSize: "7px", color: "#888", marginTop: "1mm" }}>
              Printed {new Date().toLocaleString()}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
