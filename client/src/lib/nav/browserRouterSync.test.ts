import { describe, expect, it } from "@jest/globals";
import { notifyBrowserRouterOfCurrentUrl } from "./browserRouterSync";

describe("notifyBrowserRouterOfCurrentUrl", () => {
  it("dispatches popstate with the current history state", () => {
    const received: PopStateEvent[] = [];
    const listener = (event: PopStateEvent) => received.push(event);

    window.history.replaceState({ routeKey: "orders" }, "", "/orders");
    window.addEventListener("popstate", listener);

    try {
      notifyBrowserRouterOfCurrentUrl();
    } finally {
      window.removeEventListener("popstate", listener);
    }

    expect(received).toHaveLength(1);
    expect(received[0].state).toEqual({ routeKey: "orders" });
  });
});
