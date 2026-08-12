import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("canonical artwork write migration", () => {
  test("order artwork finalization creates the canonical source relation before its compatibility attachment", () => {
    const ordersRoutes = source("../routes/orders.routes.ts");
    expect(ordersRoutes).toContain("canonicalArtworkWriteService.attachSourceArtwork");
    expect(ordersRoutes.indexOf("canonicalArtworkWriteService.attachSourceArtwork")).toBeLessThan(ordersRoutes.indexOf("tx.insert(orderAttachments).values"));
    expect(ordersRoutes).toContain("role: (role || (orderLineItemId ? 'artwork' : 'other')) as FileRole");
  });

  test("production promotion creates the canonical production relation before its lineItemFiles projection", () => {
    const prepress = source("../prepressFileService.ts");
    const assignment = prepress.slice(prepress.indexOf("export async function assignCustomerArtworkAsProductionArtwork"));
    expect(assignment).toContain("canonicalArtworkWriteService.promoteArtworkForProduction");
    expect(assignment.indexOf("canonicalArtworkWriteService.promoteArtworkForProduction")).toBeLessThan(assignment.indexOf("tx.insert(lineItemFiles).values"));
  });

  test("explicit quote-line-item transfers create canonical source artwork with their attachment projection", () => {
    const ordersRepository = source("../storage/orders.repo.ts");
    const conversion = ordersRepository.slice(ordersRepository.indexOf("// Copy quote line item attachments to order line items"));
    expect(conversion).toContain("canonicalArtworkWriteService.attachSourceArtwork");
    expect(conversion.indexOf("canonicalArtworkWriteService.attachSourceArtwork")).toBeLessThan(conversion.indexOf("tx.insert(orderAttachments).values(orderAttachmentInserts)"));
  });

  test("legacy proof and run artifacts remain outside the canonical writer", () => {
    const writer = source("../services/artwork/CanonicalArtworkWriteService.ts");
    expect(writer).toContain("async supersedeArtwork");
    expect(writer).not.toContain('role: "proof"');
    expect(writer).not.toContain('role: "combined_run"');
  });
});
