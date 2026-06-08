import React from "react";
import { act } from "react";
import { describe, expect, test } from "@jest/globals";
import { TextDecoder, TextEncoder } from "util";

(globalThis as any).TextEncoder = TextEncoder;
(globalThis as any).TextDecoder = TextDecoder;
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const { MemoryRouter } = require("react-router-dom") as typeof import("react-router-dom");
const { createRoot } = require("react-dom/client") as typeof import("react-dom/client");
const { ProductIntakeDraftBanner } = require("./ProductIntakeDraftBanner") as typeof import("./ProductIntakeDraftBanner");

describe("ProductIntakeDraftBanner", () => {
  test("renders inactive Product Intake draft context and review links", () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    act(() => {
      root.render(
        <MemoryRouter>
          <ProductIntakeDraftBanner
            link={{
              sessionId: "sess_1",
              productId: "prod_1",
              pbv2TreeVersionId: "tree_1",
              sessionStatus: "draft_created",
              productIsActive: false,
              pbv2Status: "DRAFT",
              pbv2ActiveTreeVersionId: null,
            }}
          />
        </MemoryRouter>,
      );
    });
    const html = container.innerHTML;

    expect(html).toContain("Created from Product Intake");
    expect(html).toContain("Product inactive");
    expect(html).toContain("PBV2 DRAFT");
    expect(html).toContain("Publish required");
    expect(html).toContain("/admin/product-intake/sessions/sess_1/review");
    expect(html).toContain("/products/prod_1/builder-v2?draftTreeVersionId=tree_1");
    act(() => root.unmount());
  });
});
