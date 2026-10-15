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
import { useFulfillmentOrderDetailQuery } from "@/hooks/useFulfillment";
import { useTicketArtworkThumbnails } from "@/hooks/useTicketArtworkThumbnails";
import { buildArtworkOutputSets } from "@shared/artworkAllocation";
import { parseItemTagRequest, validTagQuantity } from "@/lib/itemTagPrint";

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
  const tagRequest = parseItemTagRequest(searchParams);

  // The direct shell is intentionally separate from the staff experience so
  // WebView2 does not start authenticated printer-profile queries or render
  // browser-print controls. The claimed-job source remains bearer-protected.
  if (hasValidDirectPrintJobId(directPrintJobId)) {
    return <DirectPrintTravelerRenderer orderId={orderId} directPrintJobId={directPrintJobId} printNote={printNote} feedMm={feedMm} />;
  }

  if (tagRequest) return <ItemTagRenderer orderId={orderId} request={tagRequest} />;

  return <InteractiveTravelerRenderer orderId={orderId} printNote={printNote} feedMm={feedMm} />;
}

function ItemTagRenderer({ orderId, request }: {
  orderId: string | undefined;
  request: NonNullable<ReturnType<typeof parseItemTagRequest>>;
}) {
  const source = useOrderTraveler(orderId, null);
  const fulfillment = useFulfillmentOrderDetailQuery(orderId);
  const printer = useStationPrinter();
  const [withoutThumbnails, setWithoutThumbnails] = useState(false);
  const [printError, setPrintError] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const includeThumbnails = request.includeThumbnails && !withoutThumbnails;
  const line = source.data?.lineItems.find(item => item.orderLineItemId === request.lineItemId);
  const detailLine = fulfillment.data?.lineItems.find(item => item.id === request.lineItemId);
  const orderedQuantity = line?.quantity;
  const quantityMismatch = detailLine?.quantity != null && detailLine.quantity !== orderedQuantity;
  const invalidQuantity = request.quantity !== null && !validTagQuantity(request.quantity, orderedQuantity);
  const artwork = detailLine?.artwork ?? [];
  const thumbnailRecords = artwork.map(item => ({ id: item.id, fileRecordId: item.fileRecordId }));
  const thumbnails = useTicketArtworkThumbnails(thumbnailRecords, includeThumbnails);
  const template = useMemo(() => loadTicketTemplate(), []);

  useEffect(() => {
    if (!orderId || !line) return;
    let active = true;
    const url = `${window.location.origin}/orders/${encodeURIComponent(orderId)}`;
    void QRCode.toDataURL(url, { margin: 1, width: 200, errorCorrectionLevel: "M" })
      .then(value => { if (active) setQrDataUrl(value); })
      .catch(() => { if (active) setQrDataUrl(null); });
    return () => { active = false; };
  }, [orderId, line?.orderLineItemId]);

  if (source.isLoading || fulfillment.isLoading) return <CenteredMessage>Loading item tag…</CenteredMessage>;
  if (source.error || fulfillment.error || !source.data || !fulfillment.data || source.data.orderId !== orderId || fulfillment.data.orderId !== orderId || !line || !detailLine || quantityMismatch || invalidQuantity || !validTagQuantity(orderedQuantity, orderedQuantity)) {
    return <CenteredMessage>Item tag is unavailable for this Order line or quantity.</CenteredMessage>;
  }

  const traveler = buildOrderTravelerData({ ...source.data, lineItems: [line] }, template);
  const lineIndex = source.data.lineItems.findIndex(item => item.orderLineItemId === request.lineItemId) + 1;
  const tagQuantity = request.quantity ?? orderedQuantity;
  const sets = buildArtworkOutputSets(artwork.map(item => ({
    id: item.id, role: "final", side: item.side,
    productionQuantity: item.productionQuantity ?? null,
    productionGroupId: item.productionGroupId ?? null,
  })));
  const artworkById = new Map(artwork.map(item => [item.id, item]));
  const fulfillmentLabel = fulfillment.data.fulfillmentMethod === "pickup" ? "Pickup" : fulfillment.data.fulfillmentMethod === "deliver" ? "Delivery" : "Shipping";

  async function printTag() {
    if (printer.profiles.length > 0 && !printer.selectedProfile) return;
    if (thumbnails.loading || thumbnails.unavailable) return;
    setPrintError(null);
    try {
      await document.fonts.ready;
      await Promise.all(Array.from(document.querySelectorAll<HTMLImageElement>("#ticket-print-area img")).map(image => image.decode()));
      if (printer.selectedProfile) void markPrinterProfileUsed(printer.selectedProfile.id);
      window.print();
    } catch {
      setPrintError("An image could not be rendered. Retry or print without thumbnails.");
    }
  }

  return <div className="min-h-screen bg-muted/40 print:bg-white">
    <style dangerouslySetInnerHTML={{ __html: THERMAL_PRINT_STYLES }} />
    <div className="ticket-no-print sticky top-0 z-10 border-b bg-background"><div className="mx-auto flex max-w-3xl flex-wrap items-center gap-3 px-4 py-3">
      <Button variant="ghost" size="sm" onClick={() => window.history.back()}><ArrowLeft className="mr-1 h-4 w-4" />Back</Button>
      <span className="text-sm font-semibold">Item Tag · Line {lineIndex}</span>
      <Button className="ml-auto" size="sm" disabled={thumbnails.loading || thumbnails.unavailable || (printer.profiles.length > 0 && !printer.selectedProfile)} onClick={() => void printTag()}><Printer className="mr-1 h-4 w-4" />Print Item Tag</Button>
    </div><div className="mx-auto max-w-3xl px-4 pb-3"><PrinterPicker printer={printer} />
      {thumbnails.loading && <p className="text-sm">Loading artwork thumbnails…</p>}
      {(thumbnails.unavailable || printError) && <div role="alert" className="flex flex-wrap items-center gap-2 text-sm"><span>{printError || "An artwork thumbnail is unavailable."}</span><Button variant="outline" size="sm" onClick={() => { setPrintError(null); thumbnails.retry(); }}>Retry</Button><Button variant="outline" size="sm" onClick={() => { setPrintError(null); setWithoutThumbnails(true); }}>Print Without Thumbnails</Button></div>}
    </div></div>
    <div className="mx-auto max-w-md px-4 py-6"><ThermalPrintPage ready={!thumbnails.loading && !thumbnails.unavailable}>
      <ThermalValue align="center" size="large">ITEM TAG</ThermalValue><ThermalDivider heavy />
      {traveler.headerRows.map(row => <div key={row.key}><ThermalSection compact><ThermalLabel align={row.format.align}>{row.label}</ThermalLabel><div style={ticketRowStyle(row.format)}>{row.value}</div></ThermalSection></div>)}
      <ThermalSection compact><ThermalLabel>Fulfillment</ThermalLabel><ThermalValue>{fulfillmentLabel}</ThermalValue></ThermalSection>
      <ThermalDivider heavy />
      <ThermalSection compact><ThermalLabel>Line {lineIndex} · {request.lineItemId}</ThermalLabel><ThermalValue size="large">{traveler.lineItems[0].description}</ThermalValue></ThermalSection>
      <ThermalSection compact><ThermalLabel>Quantity on this tag</ThermalLabel><ThermalValue size="xlarge">QTY {tagQuantity} OF {orderedQuantity}</ThermalValue></ThermalSection>
      <ThermalSection compact><ThermalLabel>Size</ThermalLabel><ThermalValue>{traveler.lineItems[0].size}</ThermalValue></ThermalSection>
      <ThermalSection compact><ThermalLabel>Material</ThermalLabel><ThermalValue>{traveler.lineItems[0].material}</ThermalValue></ThermalSection>
      {traveler.lineItems[0].selectedOptions.map((option, index) => <ThermalSection compact key={`${option.optionLabel}-${index}`}><ThermalLabel>{option.optionLabel}</ThermalLabel><ThermalValue>{option.selectedLabel}</ThermalValue></ThermalSection>)}
      {artwork.length > 0 && <><ThermalDivider /><ThermalSection compact><ThermalLabel>Artwork</ThermalLabel>
        {sets.map((set, index) => <div key={set.id} style={{ marginTop: "1.5mm" }}><strong>Set {index + 1} · {set.quantity == null ? "Allocation not specified" : `QTY ${set.quantity}`}</strong>
          {set.memberIds.map(id => { const item = artworkById.get(id); if (!item) return null; const thumbnail = thumbnails.images[id]; return <div key={id} style={{ marginTop: "1mm", fontSize: "12px", overflowWrap: "anywhere" }}>
            {item.fileName}{item.side ? ` · ${item.side.toUpperCase()}` : ""}
            {includeThumbnails && thumbnail?.status === "ready" && <img src={thumbnail.src} alt={`${item.fileName} thumbnail`} style={{ width: "100%", maxHeight: "40mm", objectFit: "contain", filter: "grayscale(1) contrast(1.15)", border: "1.5px solid #000" }} />}
            {includeThumbnails && thumbnail?.status === "unavailable" && <div>Thumbnail unavailable</div>}
          </div>; })}
        </div>)}
      </ThermalSection></>}
      <ThermalDivider heavy /><ThermalQrBlock qrDataUrl={qrDataUrl} alt="Order QR code" instruction="Scan to open this Order" timestamp={`Prepared ${new Date().toLocaleString()}`} />
    </ThermalPrintPage></div>
  </div>;
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
  const boxIndexes = pickupContext?.box !== undefined ? [pickupContext.box?.current ?? null] : pickupContext ? Array.from({ length: pickupContext.boxCount }, (_, index) => index + 1) : [null];
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
          <ThermalPrintPage ready key={boxIndex ?? "standard"} feedSpacer={controls ? undefined : travelerFeedSpacerMm(feedMm)} forceFeedSentinel={forceFeedSentinel} style={pickupContext?.box === undefined && boxIndex && boxIndex > 1 ? { marginTop: "8mm", breakBefore: "page" } : undefined}>
          <ThermalValue align="center" size="normal" style={{ textTransform: "uppercase" }}>
            {pickupContext ? "Pickup Traveler" : "Order Traveler"}
          </ThermalValue>
          {data.pickupStatus === "REVERSED" || data.pickupStatus === "PARTIALLY_REVERSED" ? <ThermalValue align="center" size="large" style={{ marginTop: "1mm" }}>{data.pickupStatus === "REVERSED" ? "REVERSED" : "PARTIALLY REVERSED"}</ThermalValue> : null}
          {pickupContext && (boxIndex || pickupContext.printBlankBoxFields) ? <ThermalValue align="center" size="large" style={{ marginTop: "1mm" }}>
            {boxIndex ? `BOX ${boxIndex} of ${pickupContext.box?.total ?? pickupContext.boxCount}` : "BOX ____ of ____"}
          </ThermalValue> : null}
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
                {li.material !== "—" || li.selectedOptions.length === 0 ? <div style={{ fontSize: "15px", fontWeight: 900, lineHeight: 1.15, marginTop: "1mm", overflowWrap: "anywhere" }}>
                  Material: {li.material}
                </div> : null}
                {li.selectedOptions.map((option, index) => <div key={`${option.optionLabel}-${index}`} style={{ fontSize: "14px", fontWeight: 800, lineHeight: 1.15, marginTop: "0.5mm", overflowWrap: "anywhere" }}>
                  {option.optionLabel}: {option.selectedLabel}
                </div>)}
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
            instruction={pickupContext ? undefined : "Scan to open order in Printers Hero"}
            timestamp={`Printed ${new Date().toLocaleString()}`}
          />
          </ThermalPrintPage>
        ))}
      </div>
    </div>
  );
}
