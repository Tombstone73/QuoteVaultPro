import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, jest, test } from "@jest/globals";
import { PrepressArtworkSideSelect } from "./PrepressArtworkSideSelect";

describe("PrepressArtworkSideSelect", () => {
  test.each(["front", "back", "both"] as const)("assigns an original file to %s", async (side) => {
    const onAssign = jest.fn();
    const host = document.createElement("div");
    const root = createRoot(host);

    await act(async () => root.render(
      <PrepressArtworkSideSelect filename="customer-art.pdf" side="na" onAssign={onAssign} />,
    ));
    const select = host.querySelector("select") as HTMLSelectElement;
    select.value = side;
    await act(async () => select.dispatchEvent(new Event("change", { bubbles: true })));

    expect(onAssign).toHaveBeenCalledWith(side);
    await act(async () => root.unmount());
  });
});
