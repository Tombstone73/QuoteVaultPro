import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test } from "@jest/globals";
import { TextDecoder, TextEncoder } from "util";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as any).TextEncoder = TextEncoder;
(globalThis as any).TextDecoder = TextDecoder;

const { MemoryRouter } = require("react-router-dom") as typeof import("react-router-dom");
const { CustomerActionsMenu } = require("./CustomerActionsMenu") as typeof import("./CustomerActionsMenu");

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

describe("CustomerActionsMenu", () => {
  test("renders Issue Customer Credit when the action is supplied", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    act(() => {
      root = createRoot(container);
      root.render(
        <MemoryRouter>
          <CustomerActionsMenu
            customerId="customer-1"
            onRecordCustomerFunds={() => undefined}
            onIssueCustomerCredit={() => undefined}
          />
        </MemoryRouter>,
      );
    });

    const trigger = container.querySelector('button[aria-label="More customer actions"]') as HTMLButtonElement;
    expect(trigger).toBeTruthy();

    act(() => {
      trigger.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
    });

    expect(document.body.textContent).toContain("Record Customer Funds");
    expect(document.body.textContent).toContain("Issue Customer Credit");
  });
});
