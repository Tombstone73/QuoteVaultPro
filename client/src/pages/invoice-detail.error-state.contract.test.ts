import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@jest/globals";

function readClient(relativePath: string) {
  const fromClient = path.resolve(process.cwd(), relativePath);
  const fromRoot = path.resolve(process.cwd(), "client", relativePath);
  return fs.readFileSync(fs.existsSync(fromClient) ? fromClient : fromRoot, "utf8");
}

test("invoice detail preserves HTTP status and only renders not-found for 404", () => {
  const hook = readClient("src/hooks/useInvoices.ts");
  const page = readClient("src/pages/invoice-detail.tsx");
  expect(hook).toContain("class InvoiceDetailRequestError");
  expect(hook).toContain("new InvoiceDetailRequestError(body?.error || 'Unable to load invoice', res.status)");
  expect(page).toContain("(error as any)?.status === 404");
  expect(page).toContain("Unable to load invoice");
  expect(page).toContain("onClick={() => void refetch()}");
});
