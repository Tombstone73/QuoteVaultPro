import { resolveTheme } from "./theme";
const assert = (value: unknown, message: string): void => {
  if (!value) throw new Error(message);
};
const light = resolveTheme("printershero", "light");
const dark = resolveTheme("printershero", "dark");
assert(
  light.tokens.app !== dark.tokens.app,
  "appearance must resolve distinct palettes",
);
const branded = resolveTheme(
  "industrial",
  "system",
  { primary: "#123456", secondary: "#abcdef" },
  true,
);
assert(
  branded.appearance === "dark" && branded.tokens.primary === "#123456",
  "system/branding resolution failed",
);
assert(
  branded.tokens.success === resolveTheme("industrial", "dark").tokens.success,
  "branding changed protected status token",
);
const unsafe = resolveTheme("printershero", "light", {
  primary: "url(javascript:alert(1))",
});
assert(
  unsafe.tokens.primary === light.tokens.primary,
  "unsafe branding value was accepted",
);
const bright = resolveTheme("printershero", "light", { primary: "#f2d84b" });
assert(
  bright.tokens.primaryForeground === "#172033",
  "accepted branding did not get a readable foreground",
);
assert(
  resolveTheme("unknown", "light").id === "printershero",
  "unknown theme did not fall back",
);
console.log("[v2-ui] theme resolver tests passed");
