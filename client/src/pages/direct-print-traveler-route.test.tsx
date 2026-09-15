import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

let mockSearchParams = new URLSearchParams();

jest.mock("react-router-dom", () => ({
  useSearchParams: () => [mockSearchParams],
  Navigate: () => <div data-testid="login">Login</div>,
}));

jest.mock("./order-traveler", () => ({
  __esModule: true,
  default: () => <div data-testid="direct-traveler-shell">Direct Traveler Shell</div>,
  hasValidDirectPrintJobId: (value: string | null) => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/.test(value),
}));

import DirectPrintTravelerRoute from "./direct-print-traveler-route";

let container: HTMLDivElement;
let root: Root;

async function renderPath(path: string) {
  mockSearchParams = new URL(path, "https://printershero.test").searchParams;
  await act(async () => {
    root.render(<DirectPrintTravelerRoute />);
  });
}

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("DirectPrintTravelerRoute", () => {
  test("keeps an unauthenticated normal Traveler behind login", async () => {
    await renderPath("/orders/order-1/traveler");
    expect(container.querySelector('[data-testid="login"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="direct-traveler-shell"]')).toBeNull();
  });

  test("mounts the direct Traveler shell only for a structurally valid claimed job", async () => {
    await renderPath("/orders/order-1/traveler?directPrintJobId=job-1");
    expect(container.querySelector('[data-testid="direct-traveler-shell"]')).toBeTruthy();
  });

  test("rejects malformed direct-print identifiers", async () => {
    await renderPath("/orders/order-1/traveler?directPrintJobId=bad%20id");
    expect(container.querySelector('[data-testid="login"]')).toBeTruthy();
  });
});
