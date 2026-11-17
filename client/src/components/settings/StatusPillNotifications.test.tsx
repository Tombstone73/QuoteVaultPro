import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, test } from "@jest/globals";
import type { OrderStatusPill } from "@/hooks/useOrderStatusPills";
import { StatusPillNotifications } from "./StatusPillNotifications";

test("an eligible status exposes separate previews and a 60-second default delay", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const container = document.createElement("div");
  const originalResizeObserver = globalThis.ResizeObserver;
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  document.body.appendChild(container);
  const root = createRoot(container);
  const queryClient = new QueryClient();
  const pill: OrderStatusPill = {
    id: "test-status", organizationId: "test-org", stateScope: "open", key: "proof",
    name: "Proof Under Review", color: "#2563EB", isActive: true, isDefault: false,
    customerVisible: true, notificationTriggerEligible: true, sortOrder: 1,
    updatedAt: "2026-11-17", createdAt: "2026-11-17",
    notificationRules: {
      customer_email: { enabled: true, template: "order_update", delaySeconds: 60 },
      staff_email: { enabled: true, template: "staff_review", delaySeconds: 0, recipients: "administrators" },
    },
  };
  try {
    await act(async () => root.render(<QueryClientProvider client={queryClient}><StatusPillNotifications pill={pill} /></QueryClientProvider>));
    await act(async () => container.querySelector("button")?.click());
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain("A subsequent status change cancels");
    expect(dialog.querySelector('[aria-label="Customer email preview"]')?.textContent).toContain("The status of your order has changed.");
    expect(dialog.querySelector('[aria-label="Internal staff email preview"]')?.textContent).toContain("Proof Under Review");
    expect((dialog.querySelector("#customer_email-delay") as HTMLInputElement).value).toBe("60");
    expect((dialog.querySelector("#staff_email-delay") as HTMLInputElement).value).toBe("0");
    await act(async () => (dialog.querySelector("#customer_portal-enabled") as HTMLButtonElement).click());
    expect((dialog.querySelector("#customer_portal-delay") as HTMLInputElement).value).toBe("60");
  } finally {
    await act(async () => root.unmount());
    queryClient.clear();
    container.remove();
    globalThis.ResizeObserver = originalResizeObserver;
  }
});
