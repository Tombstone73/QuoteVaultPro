import { describe, expect, test } from "@jest/globals";
import { clampFloatingBounds, moveFloatingBounds, resizeFloatingBounds, type ResizeDirection } from "./assistantFloatingBounds";

const viewport = { width: 1200, height: 900 };
const original = { x: 300, y: 200, width: 440, height: 500 };

describe("floating assistant bounds", () => {
  test.each<ResizeDirection>(["n", "ne", "e", "se", "s", "sw", "w", "nw"])("%s resizes only its edges and anchors the opposite sides", direction => {
    const result = resizeFloatingBounds(original, direction, 80, 60, viewport);
    expect(result.x + result.width).toBe(direction.includes("w") ? original.x + original.width : original.x + (direction.includes("e") ? original.width + 80 : original.width));
    expect(result.y + result.height).toBe(direction.includes("n") ? original.y + original.height : original.y + (direction.includes("s") ? original.height + 60 : original.height));
    if (direction.includes("w")) expect(result.x).toBe(original.x + 80);
    else expect(result.x).toBe(original.x);
    if (direction.includes("n")) expect(result.y).toBe(original.y + 60);
    else expect(result.y).toBe(original.y);
  });

  test("minimum dimensions and viewport edges prevent stranded controls", () => {
    expect(resizeFloatingBounds(original, "nw", 2000, 2000, viewport)).toEqual({ x: 420, y: 340, width: 320, height: 360 });
    expect(resizeFloatingBounds(original, "se", 2000, 2000, viewport)).toEqual({ x: 300, y: 200, width: 888, height: 688 });
    expect(moveFloatingBounds(original, 3000, 3000, viewport)).toEqual({ x: 748, y: 388, width: 440, height: 500 });
  });

  test("saved desktop bounds shrink into a zoomed or narrow viewport", () => {
    expect(clampFloatingBounds({ x: 900, y: 800, width: 800, height: 750 }, { width: 280, height: 300 }))
      .toEqual({ x: 12, y: 12, width: 256, height: 276 });
    expect(clampFloatingBounds({ x: NaN, y: Infinity, width: NaN, height: -1 }, viewport))
      .toEqual({ x: 12, y: 12, width: 320, height: 360 });
  });
});
