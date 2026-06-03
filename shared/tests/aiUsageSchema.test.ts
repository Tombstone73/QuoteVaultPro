import { describe, expect, test } from "@jest/globals";
import { getTableColumns } from "drizzle-orm";
import { readFileSync } from "fs";
import { join } from "path";
import { aiUsage, insertAiUsageSchema } from "../schema";

describe("AI usage schema", () => {
  test("requires model for usage writes", () => {
    expect(() => insertAiUsageSchema.parse({
      orgId: "org_1",
      feature: "bug_review",
      provider: "openai",
      mode: "printershero_managed",
    })).toThrow();
  });

  test("defines billing defaults for cost, currency, and pricing snapshot", () => {
    const columns = getTableColumns(aiUsage) as Record<string, any>;

    expect(columns.estimatedCostCents.notNull).toBe(true);
    expect(columns.estimatedCostCents.hasDefault).toBe(true);
    expect(columns.estimatedCostCents.default).toBe(0);
    expect(columns.costCurrency.notNull).toBe(true);
    expect(columns.costCurrency.hasDefault).toBe(true);
    expect(columns.costCurrency.default).toBe("USD");
    expect(columns.pricingSnapshot.notNull).toBe(true);
    expect(columns.pricingSnapshot.hasDefault).toBe(true);

    const migration = readFileSync(
      join(process.cwd(), "server/db/migrations_v2/0086_ai_usage_billing_basis.sql"),
      "utf8",
    );
    expect(migration).toContain("estimated_cost_cents SET DEFAULT 0");
    expect(migration).toContain("cost_currency text NOT NULL DEFAULT 'USD'");
    expect(migration).toContain("pricing_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb");
  });

  test("rejects managed usage without pricing snapshot billing basis", () => {
    expect(() => insertAiUsageSchema.parse({
      orgId: "org_1",
      feature: "bug_review",
      provider: "openai",
      model: "gpt-4o-mini",
      mode: "printershero_managed",
    })).toThrow();
  });

  test("accepts managed usage with pricing snapshot billing basis", () => {
    const parsed = insertAiUsageSchema.parse({
      orgId: "org_1",
      feature: "triage_brief",
      provider: "openai",
      model: "gpt-4o-mini",
      mode: "printershero_managed",
      inputTokens: 1200,
      outputTokens: 350,
      totalTokens: 1550,
      estimatedCostCents: 1,
      costCurrency: "USD",
      pricingSnapshot: {
        basis: "estimated",
        currency: "USD",
        provider: "openai",
        model: "gpt-4o-mini",
        inputTokens: 1200,
        outputTokens: 350,
        inputCostPerMillionTokensCents: 15,
        outputCostPerMillionTokensCents: 60,
      },
    });

    expect(parsed.mode).toBe("printershero_managed");
    expect(parsed.feature).toBe("triage_brief");
    expect(parsed.estimatedCostCents).toBe(1);
    expect(parsed.pricingSnapshot).toMatchObject({
      basis: "estimated",
      model: "gpt-4o-mini",
    });
  });

  test("accepts BYOK usage with zero Printers Hero cost", () => {
    const parsed = insertAiUsageSchema.parse({
      orgId: "org_1",
      feature: "bug_review",
      provider: "anthropic",
      model: "claude-test",
      mode: "bring_your_own",
      estimatedCostCents: 0,
      costCurrency: "USD",
      pricingSnapshot: {
        basis: "customer_paid_byok",
        provider: "anthropic",
        model: "claude-test",
        billableToPrintersHero: false,
      },
    });

    expect(parsed.mode).toBe("bring_your_own");
    expect(parsed.estimatedCostCents).toBe(0);
    expect(parsed.pricingSnapshot).toMatchObject({
      basis: "customer_paid_byok",
      billableToPrintersHero: false,
    });
  });
});
