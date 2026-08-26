import { describe, expect, it } from "@jest/globals";
import {
  buildJobTicketQrUrl,
  ticketRowStyle,
  THERMAL_FEED_SPACER_DEFAULT,
  THERMAL_PRINT_STYLES,
  TICKET_FONT_SIZE_PX,
} from "./ticketRender";
import { DEFAULT_TICKET_TEMPLATE } from "@shared/productionTicket";

describe("ticketRowStyle", () => {
  it("emphasises the order number field (extra large, bold)", () => {
    const style = ticketRowStyle(DEFAULT_TICKET_TEMPLATE.fields.orderNumber);
    expect(style.fontSize).toBe(`${TICKET_FONT_SIZE_PX.xlarge}px`);
    expect(style.fontWeight).toBe(800);
  });

  it("renders non-bold fields with thermal-readable weight", () => {
    const style = ticketRowStyle({
      ...DEFAULT_TICKET_TEMPLATE.fields.jobId,
      fontSize: "normal",
      fontWeight: "normal",
    });
    expect(style.fontWeight).toBe(700);
    expect(style.fontSize).toBe(`${TICKET_FONT_SIZE_PX.normal}px`);
  });

  it("passes through alignment", () => {
    const style = ticketRowStyle({
      ...DEFAULT_TICKET_TEMPLATE.fields.jobId,
      align: "right",
    });
    expect(style.textAlign).toBe("right");
  });

  it("allows long physical-document values to wrap safely", () => {
    const style = ticketRowStyle(DEFAULT_TICKET_TEMPLATE.fields.jobLabel);
    expect(style.overflowWrap).toBe("anywhere");
    expect(style.wordBreak).toBe("break-word");
  });

  it("orders font sizes small < normal < large < xlarge", () => {
    const { small, normal, large, xlarge } = TICKET_FONT_SIZE_PX;
    expect(small).toBeLessThan(normal);
    expect(normal).toBeLessThan(large);
    expect(large).toBeLessThan(xlarge);
  });
});

describe("THERMAL_PRINT_STYLES", () => {
  it("uses zero-margin 80mm thermal page sizing", () => {
    expect(THERMAL_PRINT_STYLES).toContain("@page { size: 80mm auto; margin: 0; }");
    expect(THERMAL_PRINT_STYLES).toContain("print-color-adjust: exact");
  });

  it("defines the default tear-off feed spacer", () => {
    expect(THERMAL_FEED_SPACER_DEFAULT).toBe("1.5in");
    expect(THERMAL_PRINT_STYLES).toContain(".thermal-feed-spacer");
    expect(THERMAL_PRINT_STYLES).toContain("var(--thermal-feed-spacer, 1.5in)");
  });
});

describe("buildJobTicketQrUrl", () => {
  it("builds a job URL from origin and job id", () => {
    expect(buildJobTicketQrUrl("https://app.titanos.com", "job-123")).toBe(
      "https://app.titanos.com/production/jobs/job-123",
    );
  });

  it("strips a trailing slash from the origin", () => {
    expect(buildJobTicketQrUrl("https://app.titanos.com/", "job-123")).toBe(
      "https://app.titanos.com/production/jobs/job-123",
    );
  });
});
