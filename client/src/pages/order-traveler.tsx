/**
 * Order Traveler - thermal whole-order summary for Epson TM-L90 style printing.
 */

import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import QRCode from "qrcode";

import { Button } from "@/components/ui/button";
import { logTravelerPrint } from "@/hooks/useProduction";
import {
  buildOrderTravelerData,
  type OrderTravelerSource,
} from "@shared/productionTicket";
import { loadTicketTemplate } from "@/lib/ticketSettings";
import { ticketRowStyle, THERMAL_PRINT_STYLES } from "@/lib/ticketRender";
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
  ThermalValue,
} from "@/components/production/ticketPrintPrimitives";
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
  const [searchParams] = useSearchParams();
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
    QRCode.toDataURL(orderUrl, { margin: 1, width: 220, errorCorrectionLevel: "M" })
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
  const printNote = searchParams.get("printNote")?.trim() || null;
  const feedMm = Number(searchParams.get("feedMm"));

  function handlePrint() {
    if (printer.profiles.length > 0 && !printer.selectedProfile) {
      window.alert("Select a printer profile before printing.");
      return;
    }
    if (printer.selectedProfile) void markPrinterProfileUsed(printer.selectedProfile.id);
    window.print();
    if (orderId) void logTravelerPrint(orderId);
  }

  if (isLoading) return <CenteredMessage>Loading order traveler...</CenteredMessage>;
  if (error || !data || !traveler) {
    return <CenteredMessage>Failed to load order traveler.</CenteredMessage>;
  }

  return (
    <div className="min-h-screen bg-muted/40 print:bg-white">
      <style dangerouslySetInnerHTML={{ __html: THERMAL_PRINT_STYLES }} />

      <div className="ticket-no-print sticky top-0 z-10 border-b bg-background">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-3 px-4 py-3">
          <Button variant="ghost" size="sm" onClick={() => window.history.back()} className="gap-1.5">
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
          <span className="rounded bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">
            Order Traveler
          </span>
          <div className="ml-auto">
            <Button onClick={handlePrint} size="sm" className="gap-1.5" disabled={printer.profiles.length > 0 && !printer.selectedProfile}>
              <Printer className="h-4 w-4" /> Print Traveler
            </Button>
          </div>
        </div>
        <div className="mx-auto max-w-3xl px-4 pb-3">
          <PrinterPicker printer={printer} />
        </div>
      </div>

      <div className="mx-auto max-w-md px-4 py-6">
        <ThermalPrintPage feedSpacer={Number.isFinite(feedMm) && feedMm > 0 ? `${feedMm}mm` : undefined}>
          <ThermalValue align="center" size="normal" style={{ textTransform: "uppercase" }}>
            Order Traveler
          </ThermalValue>
          <ThermalDivider heavy />
          {printNote ? <><ThermalLabel>Print Note</ThermalLabel><ThermalValue size="normal" style={{ margin: "1.5mm 0" }}>{printNote}</ThermalValue><ThermalDivider /></> : null}

          {traveler.headerRows.map((row) => (
            <div key={row.key}>
              {row.format.dividerBefore && <ThermalDivider />}
              <ThermalSection compact>
                {row.key !== "rush" && (
                  <ThermalLabel align={row.format.align}>{row.label}</ThermalLabel>
                )}
                <div style={ticketRowStyle(row.format)}>
                  {row.key === "rush" ? `*** ${row.value} ***` : row.value}
                </div>
              </ThermalSection>
              {row.format.dividerAfter && <ThermalDivider />}
            </div>
          ))}

          <ThermalDivider heavy />
          <ThermalLabel>
            Line Items ({traveler.lineItemCount}) - Total Qty {traveler.totalQuantity}
          </ThermalLabel>
          {traveler.lineItems.length === 0 ? (
            <ThermalValue size="normal" style={{ margin: "1.5mm 0" }}>
              No line items on this order.
            </ThermalValue>
          ) : (
            traveler.lineItems.map((li) => (
              <div
                key={li.index}
                style={{ borderTop: "2px solid #000", padding: "1.75mm 0 1.25mm" }}
              >
                <div style={{ fontWeight: 900, fontSize: "18px", lineHeight: 1.1 }}>
                  {li.index}. {li.description}
                </div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: "2mm",
                    marginTop: "1mm",
                    fontSize: "16px",
                    fontWeight: 900,
                    lineHeight: 1.1,
                  }}
                >
                  <span>Qty: {li.quantity}</span>
                  <span style={{ textAlign: "right" }}>{li.size}</span>
                </div>
                <div style={{ fontSize: "15px", fontWeight: 900, lineHeight: 1.15, marginTop: "1mm" }}>
                  Material: {li.material}
                </div>
                {li.productionNotes && (
                  <div style={{ fontSize: "14px", fontWeight: 800, lineHeight: 1.15, marginTop: "1mm" }}>
                    Notes: {li.productionNotes}
                  </div>
                )}
              </div>
            ))
          )}

          <ThermalDivider heavy />
          <ThermalQrBlock
            qrDataUrl={qrDataUrl}
            alt="Order QR code"
            instruction="Scan to open order in Printers Hero"
            timestamp={`Printed ${new Date().toLocaleString()}`}
          />
        </ThermalPrintPage>
      </div>
    </div>
  );
}
