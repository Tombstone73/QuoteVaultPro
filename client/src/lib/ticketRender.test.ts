import { describe, expect, it } from "@jest/globals";
import { buildJobTicketQrUrl, ticketRowStyle, TICKET_FONT_SIZE_PX } from "./ticketRender";
import { DEFAULT_TICKET_TEMPLATE } from "@shared/productionTicket";

describe("ticketRowStyle", () => {
  it("emphasises the order number field (extra large, bold)", () => {
    const style = ticketRowStyle(DEFAULT_TICKET_TEMPLATE.fields.orderNumber);
    expect(style.fontSize).toBe(`${TICKET_FONT_SIZE_PX.xlarge}px`);
    expect(style.fontWeight).toBe(700);
  });

  it("renders normal-weight fields at weight 400", () => {
    const style = ticketRowStyle(DEFAULT_TICKET_TEMPLATE.fields.description);
    expect(style.fontWeight).toBe(400);
    expect(style.fontSize).toBe(`${TICKET_FONT_SIZE_PX.normal}px`);
  });

  it("passes through alignment", () => {
    const style = ticketRowStyle({
      ...DEFAULT_TICKET_TEMPLATE.fields.jobId,
      align: "right",
    });
    expect(style.textAlign).toBe("right");
  });

  it("orders font sizes small < normal < large < xlarge", () => {
    const { small, normal, large, xlarge } = TICKET_FONT_SIZE_PX;
    expect(small).toBeLessThan(normal);
    expect(normal).toBeLessThan(large);
    expect(large).toBeLessThan(xlarge);
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
