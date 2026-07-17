import React from "react";
import { describe, expect, it } from "@jest/globals";
import { TextDecoder, TextEncoder } from "util";
import { PrepressArtworkSideBadge } from "./PrepressArtworkSideBadge";

(globalThis as any).TextEncoder = TextEncoder;
(globalThis as any).TextDecoder = TextDecoder;
const { renderToStaticMarkup } = require("react-dom/server") as typeof import("react-dom/server");

describe("PrepressArtworkSideBadge", () => {
  it.each([
    ["front", "Front"],
    ["back", "Back"],
    ["both", "Both"],
    ["na", "Unassigned"],
  ] as const)("renders %s assignment metadata as %s", (...[side, label]) => {
    const markup = renderToStaticMarkup(<PrepressArtworkSideBadge side={side} />);
    expect(markup).toContain(`data-testid="prepress-artwork-side-${side}"`);
    expect(markup).toContain(label);
  });
});
