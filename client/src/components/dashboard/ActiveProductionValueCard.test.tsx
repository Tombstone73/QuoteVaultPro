/// <reference types="jest" />

import { TextDecoder, TextEncoder } from "util";
import ActiveProductionValueCard from "./ActiveProductionValueCard";

Object.assign(globalThis, { TextDecoder, TextEncoder });
const { renderToStaticMarkup } = require("react-dom/server") as typeof import("react-dom/server");

test("renders the total prominently with exact cents and its status-pill breakdown", () => {
  const markup = renderToStaticMarkup(<ActiveProductionValueCard value={{ totalCents: 42_815_50, newCents: 12_440_00, inProductionCents: 30_375_50 }} />);
  expect(markup).toContain("Active Production Value");
  expect(markup).toContain("$42,815.50");
  expect(markup).toContain("New:");
  expect(markup).toContain("$12,440.00");
  expect(markup).toContain("In Production:");
  expect(markup).toContain("$30,375.50");
});
