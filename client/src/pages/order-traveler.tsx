/**
 * Order Traveler - thermal whole-order summary for Epson TM-L90 style printing.
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
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
import { apiFetch } from "@/lib/queryClient";
import { travelerFeedSpacerMm } from "@/lib/travelerTrailingFeed";

export function hasValidDirectPrintJobId(value: string | null): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/.test(value);
}

function useOrderTraveler(orderId: string | undefined, directPrintJobId: string | null) {
  return useQuery<OrderTravelerSource>({
    queryKey: ["/api/orders", orderId, "traveler", directPrintJobId],
    queryFn: async () => {
      const url = directPrintJobId
        ? `/api/local-bridge/direct-print/jobs/${encodeURIComponent(directPrintJobId)}/traveler`
        : `/api/orders/${orderId}/traveler`;
      // apiFetch resolves `/api/*` through the deployment's canonical API
      // origin. This matters for off-screen direct printing because the
      // Traveler document is deliberately hosted on the web-app origin.
      const res = await apiFetch(url);
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
  const directPrintJobId = searchParams.get("directPrintJobId");
  const printNote = searchParams.get("printNote")?.trim() || null;
  const feedMm = Number(searchParams.get("feedMm"));

  // The direct shell is intentionally separate from the staff experience so
  // WebView2 does not start authenticated printer-profile queries or render
  // browser-print controls. The claimed-job source remains bearer-protected.
  if (hasValidDirectPrintJobId(directPrintJobId)) {
    return <DirectPrintTravelerRenderer orderId={orderId} directPrintJobId={directPrintJobId} printNote={printNote} feedMm={feedMm} />;
  }

  return <InteractiveTravelerRenderer orderId={orderId} printNote={printNote} feedMm={feedMm} />;
}

type TravelerRendererProps = {
  orderId: string | undefined;
  printNote: string | null;
  feedMm: number;
};

function DirectPrintTravelerRenderer({ orderId, directPrintJobId, printNote, feedMm }: TravelerRendererProps & { directPrintJobId: string }) {
  const source = useOrderTraveler(orderId, directPrintJobId);
  return <TravelerDocument {...source} orderId={orderId} printNote={printNote} feedMm={feedMm} forceFeedSentinel />;
}

function InteractiveTravelerRenderer({ orderId, printNote, feedMm }: TravelerRendererProps) {
  const source = useOrderTraveler(orderId, null);
  const printer = useStationPrinter();

  function handlePrint() {
    if (printer.profiles.length > 0 && !printer.selectedProfile) {
      window.alert("Select a printer profile before printing.");
      return;
    }
    if (printer.selectedProfile) void markPrinterProfileUsed(printer.selectedProfile.id);
    window.print();
    if (orderId) void logTravelerPrint(orderId);
  }

  const controls = (
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
  );

  return <TravelerDocument {...source} orderId={orderId} printNote={printNote} feedMm={feedMm} controls={controls} />;
}

type TravelerDocumentProps = {
  orderId: string | undefined;
  data: OrderTravelerSource | undefined;
  isLoading: boolean;
  error: unknown;
  printNote: string | null;
  feedMm: number;
  controls?: ReactNode;
  forceFeedSentinel?: boolean;
};

function TravelerDocument({ orderId, data, isLoading, error, printNote, feedMm, controls, forceFeedSentinel = false }: TravelerDocumentProps) {

  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
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
  const pickupContext = data?.pickupPrintContext?.fulfillmentMode === "pickup" ? data.pickupPrintContext : null;
  const boxIndexes = pickupContext ? Array.from({ length: pickupContext.boxCount }, (_, index) => index + 1) : [null];
  if (isLoading) return <CenteredMessage>Loading order traveler...</CenteredMessage>;
  if (error || !data || !traveler) {
    return <CenteredMessage>Failed to load order traveler.</CenteredMessage>;
  }

  return (
    <div className="min-h-screen bg-muted/40 print:bg-white">
      <style dangerouslySetInnerHTML={{ __html: THERMAL_PRINT_STYLES }} />

      {controls}

      <div className="mx-auto max-w-md px-4 py-6">
        {boxIndexes.map((boxIndex) => (
          <ThermalPrintPage ready key={boxIndex ?? "standard"} feedSpacer={controls ? undefined : travelerFeedSpacerMm(feedMm)} forceFeedSentinel={forceFeedSentinel} style={boxIndex && boxIndex > 1 ? { marginTop: "8mm", breakBefore: "page" } : undefined}>
          <ThermalValue align="center" size="normal" style={{ textTransform: "uppercase" }}>
            {pickupContext ? "Pickup Traveler" : "Order Traveler"}
          </ThermalValue>
          {pickupContext && boxIndex ? <><ThermalValue align="center" size="large" style={{ marginTop: "1mm" }}>Box {boxIndex} of {pickupContext.boxCount}</ThermalValue><ThermalDivider heavy /></> : null}
          <ThermalDivider heavy />

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
            Line Items ({traveler.lineItemCount}){!pickupContext ? ` - Total Qty ${traveler.totalQuantity}` : ""}
          </ThermalLabel>
          {pickupContext?.progressSnapshot ? <div style={{ fontSize: "14px", fontWeight: 800, lineHeight: 1.15, margin: "1mm 0" }}>Planned quantities at preparation.<br />Not pickup confirmation.</div> : null}
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
                  {!pickupContext ? <span>Qty: {li.quantity}</span> : null}
                  <span style={{ textAlign: "right" }}>{li.size}</span>
                </div>
                <div style={{ fontSize: "15px", fontWeight: 900, lineHeight: 1.15, marginTop: "1mm" }}>
                  Material: {li.material}
                </div>
                {pickupContext ? (
                  <div data-testid="pickup-quantity-progress" style={{ fontSize: "16px", fontWeight: 900, lineHeight: 1.2, marginTop: "1.25mm", overflowWrap: "anywhere" }}>
                    {li.pickupProgress ? <>
                      <div>Qty ordered: {li.pickupProgress.orderedQuantity}</div>
                      <div>Previously picked up: {li.pickupProgress.previouslyPickedUpQuantity}</div>
                      <div>This pickup: {li.pickupProgress.thisPickupQuantity}</div>
                      <div>After pickup: {li.pickupProgress.afterPickupQuantity} / {li.pickupProgress.orderedQuantity}</div>
                      {li.pickupProgress.otherResolvedQuantity > 0 ? <div>Other fulfilled/closed: {li.pickupProgress.otherResolvedQuantity}</div> : null}
                      <div>Remaining after pickup: {li.pickupProgress.remainingAfterPickupQuantity}</div>
                    </> : <><div>This pickup: {li.quantity}</div><div>Progress unavailable for this older Traveler.</div></>}
                  </div>
                ) : null}
                {li.productionNotes && (
                  <div style={{ fontSize: "14px", fontWeight: 800, lineHeight: 1.15, marginTop: "1mm" }}>
                    Notes: {li.productionNotes}
                  </div>
                )}
              </div>
            ))
          )}

          {printNote ? <><ThermalDivider heavy /><ThermalSection compact><div data-testid="traveler-print-note"><ThermalLabel>Print Note</ThermalLabel><ThermalValue size="normal" style={{ margin: "1.5mm 0", whiteSpace: "pre-wrap", overflowWrap: "anywhere", wordBreak: "break-word" }}>{printNote}</ThermalValue></div></ThermalSection></> : null}
          <ThermalDivider heavy />
          <ThermalQrBlock
            qrDataUrl={qrDataUrl}
            alt="Order QR code"
            instruction="Scan to open order in Printers Hero"
            timestamp={`Printed ${new Date().toLocaleString()}`}
          />
          </ThermalPrintPage>
        ))}
      </div>
    </div>
  );
}
