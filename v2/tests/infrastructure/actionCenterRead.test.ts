import { describe, expect, test } from "@jest/globals";
import { PostgresActionCenterReader } from "../../infrastructure/compatibility/postgresActionCenterRead";

describe("M7.5K action-center PostgreSQL projection", () => {
  test("uses one tenant-bound statement for only the capability-visible categories", async () => {
    const calls: { text: string; values?: readonly unknown[] }[] = [];
    const reader = new PostgresActionCenterReader({ query: async <T>(text: string, values?: readonly unknown[]) => {
      calls.push({ text, values });
      return { rows: [{ kind: "inbound", count: "3" }, { kind: "invoices", count: "2" }] as T[] };
    } } as any);
    await expect(reader.summary("org-a", ["inbound", "invoices"])).resolves.toEqual([
      { kind: "inbound", label: "Inbound needs review", href: "/inbound-orders", count: 3 },
      { kind: "invoices", label: "Open invoice balances", href: "/invoices", count: 2 },
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.values).toEqual(["org-a"]);
    expect(calls[0]!.text).toContain("v2_inbound_intakes");
    expect(calls[0]!.text).toContain("v2_billing_invoices");
    expect(calls[0]!.text).not.toContain("v2_prepress_units");
  });
});
