/**
 * Shared linerless thermal print primitives for Epson TM-L90 style tickets.
 * These are intentionally blunt: large type, black ink, compact spacing, and a
 * post-print feed spacer for tear-off room.
 */

import type { CSSProperties, ReactNode } from "react";
import {
  THERMAL_FEED_SPACER_DEFAULT,
  THERMAL_PAGE_PADDING,
  THERMAL_PAPER_WIDTH,
  THERMAL_PRINT_AREA_ID,
} from "@/lib/ticketRender";

type Align = "left" | "center" | "right";

export function ThermalPrintPage({
  children,
  feedSpacer = THERMAL_FEED_SPACER_DEFAULT,
  style,
}: {
  children: ReactNode;
  feedSpacer?: string;
  style?: CSSProperties;
}) {
  const feedSpacerStyle = { "--thermal-feed-spacer": feedSpacer } as CSSProperties;
  return (
    <div
      id={THERMAL_PRINT_AREA_ID}
      className="mx-auto bg-white text-black"
      style={{
        ...feedSpacerStyle,
        width: THERMAL_PAPER_WIDTH,
        padding: THERMAL_PAGE_PADDING,
        fontFamily: "Arial, Helvetica, sans-serif",
        color: "#000",
        background: "#fff",
        boxSizing: "border-box",
        ...style,
      }}
    >
      {children}
      <ThermalFeedSpacer height={feedSpacer} />
    </div>
  );
}

export function ThermalSection({
  children,
  compact = false,
  style,
}: {
  children: ReactNode;
  compact?: boolean;
  style?: CSSProperties;
}) {
  return (
    <div style={{ margin: compact ? "1mm 0" : "1.75mm 0", ...style }}>
      {children}
    </div>
  );
}

export function ThermalLabel({ children, align = "left" }: { children: ReactNode; align?: Align }) {
  return (
    <div
      style={{
        fontSize: "13px",
        fontWeight: 900,
        lineHeight: 1.05,
        textAlign: align,
        textTransform: "uppercase",
        letterSpacing: "0.02em",
        color: "#000",
      }}
    >
      {children}
    </div>
  );
}

export function ThermalValue({
  children,
  align = "left",
  size = "normal",
  strong = true,
  style,
}: {
  children: ReactNode;
  align?: Align;
  size?: "normal" | "large" | "xlarge";
  strong?: boolean;
  style?: CSSProperties;
}) {
  const fontSize = size === "xlarge" ? "26px" : size === "large" ? "20px" : "15px";
  return (
    <div
      style={{
        fontSize,
        fontWeight: strong ? 900 : 700,
        lineHeight: 1.12,
        textAlign: align,
        color: "#000",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function ThermalDivider({ heavy = false }: { heavy?: boolean }) {
  return (
    <div
      style={{
        borderTop: heavy ? "2px solid #000" : "1.5px dashed #000",
        margin: heavy ? "1.75mm 0" : "1.25mm 0",
      }}
    />
  );
}

/** Back-compat alias used by older thermal pages. */
export function TicketDivider() {
  return <ThermalDivider />;
}

export function ThermalQrBlock({
  qrDataUrl,
  alt,
  instruction,
  timestamp,
  unavailableText = "QR unavailable",
  children,
}: {
  qrDataUrl: string | null;
  alt: string;
  instruction: string;
  timestamp: string;
  unavailableText?: string;
  children?: ReactNode;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "3mm", marginTop: "2mm" }}>
      {qrDataUrl ? (
        <img src={qrDataUrl} alt={alt} style={{ width: "28mm", height: "28mm", flex: "0 0 auto" }} />
      ) : (
        <div
          style={{
            width: "28mm",
            height: "28mm",
            border: "2px solid #000",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "13px",
            fontWeight: 900,
            textAlign: "center",
          }}
        >
          {unavailableText}
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: "15px", fontWeight: 900, lineHeight: 1.12 }}>
          {instruction}
        </div>
        {children}
        <div style={{ fontSize: "13px", fontWeight: 800, lineHeight: 1.12, marginTop: "1.5mm" }}>
          {timestamp}
        </div>
      </div>
    </div>
  );
}

export function ThermalFeedSpacer({ height = THERMAL_FEED_SPACER_DEFAULT }: { height?: string }) {
  return <div className="thermal-feed-spacer" style={{ "--thermal-feed-spacer": height } as CSSProperties} />;
}

/** Full-screen centered status message (loading / error states). */
export function CenteredMessage({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center p-6 text-sm text-muted-foreground">
      {children}
    </div>
  );
}
