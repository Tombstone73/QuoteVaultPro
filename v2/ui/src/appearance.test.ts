import assert from "node:assert/strict";
import {
  defaultVisualAppearance,
  normalizeVisualAppearance,
} from "./appearance";

const allThemes = [
  "light",
  "dark",
  "command",
  "contrast",
  "lowglare",
  "warm",
];
for (const theme of allThemes) {
  assert.equal(
    normalizeVisualAppearance({ theme: theme as typeof defaultVisualAppearance.theme })
      .theme,
    theme,
    `approved theme ${theme} must remain selectable`,
  );
}
assert.deepEqual(
  normalizeVisualAppearance({
    theme: "unknown" as never,
    fontScale: 12,
    sidebar: "invalid" as never,
  }),
  defaultVisualAppearance,
  "invalid persisted browser preferences must safely fall back",
);
assert.deepEqual(
  normalizeVisualAppearance({
    density: "compact",
    accent: "teal",
    corners: "sharp",
    font: "atkinson",
    fontScale: 1.125,
    colorVision: "deutan",
    statusBoost: true,
  }),
  {
    ...defaultVisualAppearance,
    density: "compact",
    accent: "teal",
    corners: "sharp",
    font: "atkinson",
    fontScale: 1.125,
    colorVision: "deutan",
    statusBoost: true,
  },
  "global appearance settings must survive the typed frontend boundary",
);
console.log("[v2-ui] visual appearance tests passed");
