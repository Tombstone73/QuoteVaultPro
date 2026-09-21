import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import path from "node:path";

const source = readFileSync(path.join(process.cwd(), "client/src/features/customers/CurrentCustomerStatement.tsx"), "utf8");

describe("CurrentCustomerStatement document actions", () => {
  test("uses the authenticated canonical API client instead of navigating the Vercel SPA to an API path", () => {
    expect(source).toContain('const statementPath = `/api/customers/${encodeURIComponent(customerId)}/current-statement`');
    expect(source).toContain("apiFetch(statementPath");
    expect(source).toContain("apiFetch(`${statementPath}/recipients`");
    expect(source).toContain("apiFetch(`${statementPath}/email`");
    expect(source).toContain("openAuthenticatedFile(`${statementPath}/pdf`)");
    expect(source).toContain("downloadAuthenticatedFile(`${statementPath}/pdf?download=1`");
    expect(source).not.toContain('window.open(`/api/customers/${customerId}/current-statement/pdf`');
  });

  test("defaults the same eligible billing recipients into the queued statement delivery", () => {
    expect(source).toContain("setSelectedRecipients(recipients.data.map((recipient) => recipient.email))");
    expect(source).toContain("Queue Statement Email");
    expect(source).toContain("The exact statement shown now will be frozen and queued for delivery");
  });
});
