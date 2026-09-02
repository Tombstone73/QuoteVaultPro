import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { ThemeProvider, useTheme } from "./useTheme";

let container: HTMLDivElement;
let root: Root;

function ThemeProbe() {
  const { theme, setTheme } = useTheme();
  return <button type="button" onClick={() => setTheme("command")}>{theme}</button>;
}

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  document.documentElement.className = "";
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.documentElement.className = "";
  localStorage.clear();
});

describe("staff theme preference", () => {
  test("persists a sidebar theme selection and restores it for the next provider", () => {
    act(() => {
      root.render(<ThemeProvider><ThemeProbe /></ThemeProvider>);
    });

    act(() => {
      (container.querySelector("button") as HTMLButtonElement).click();
    });

    expect(localStorage.getItem("themeId")).toBe("command");
    expect(document.documentElement.classList.contains("theme-command")).toBe(true);

    act(() => root.unmount());
    root = createRoot(container);
    act(() => {
      root.render(<ThemeProvider><ThemeProbe /></ThemeProvider>);
    });

    expect(container.querySelector("button")?.textContent).toBe("command");
  });
});
