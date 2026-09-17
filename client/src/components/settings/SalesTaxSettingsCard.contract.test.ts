import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@jest/globals";

const source = fs.readFileSync(path.join(process.cwd(), "client/src/components/settings/SalesTaxSettingsCard.tsx"), "utf8");

test("Sales Tax settings presents percentages and saves canonical decimal rates", () => {
  expect(source).toContain('formatTaxRatePercent(settings.defaultTaxRate)');
  expect(source).toContain('defaultTaxRate: taxRateDecimalFromPercent(parsedPercent)');
  expect(source).toContain('Enable sales tax');
  expect(source).toContain('Default sales tax rate (%)');
  expect(source).toContain('Used for taxable customers unless a customer or document-specific tax setting overrides it.');
});
