import { describe, expect, test } from "@jest/globals";
import { isOrdersRowNavigationExcluded } from "./ordersRowNavigation";

describe("Orders row navigation exclusions", () => {
  test("navigates normal row content but excludes the entire marked status cell", () => {
    const row = document.createElement("tr");
    const normalCell = document.createElement("td");
    const statusCell = document.createElement("td");
    const statusTrigger = document.createElement("button");
    statusCell.dataset.stopRowNav = "true";
    statusCell.append(statusTrigger);
    row.append(normalCell, statusCell);

    let navigations = 0;
    row.addEventListener("click", (event) => {
      if (!isOrdersRowNavigationExcluded(event.target)) navigations += 1;
    });

    normalCell.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    statusCell.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    statusTrigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(navigations).toBe(1);
  });

  test("does not interfere with keyboard events inside a status control", () => {
    const statusTrigger = document.createElement("button");
    statusTrigger.dataset.stopRowNav = "true";
    let keyboardEvents = 0;
    statusTrigger.addEventListener("keydown", () => { keyboardEvents += 1; });

    statusTrigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(keyboardEvents).toBe(1);
  });
});
