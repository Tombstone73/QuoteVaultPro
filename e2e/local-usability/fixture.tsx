import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { ThemeProvider, useTheme } from "@/hooks/useTheme";
import { TooltipProvider } from "@/components/ui/tooltip";
import { NavigationGuardProvider } from "@/contexts/NavigationGuardContext";
import { OrderDueDateField } from "@/features/quotes/editor/components/OrderDetailsFields";
import { dateOnlyDeadline, type OrderDeadline } from "@shared/orderDeadline";
import Customers from "@/pages/customers";
import PrinterSettingsPage from "@/pages/settings/printers";
import Prepress from "@/pages/PrepressProductionPageV2";
import { PrinterPicker } from "@/components/production/PrinterPicker";
import "../../client/src/index.css";

// Synthetic HTTP only: never connects to a printer, customer DB, or operational API.
const requests: Array<{ path: string; method: string }> = [];
let active = true;
const originalFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const path = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.origin).pathname;
  if (!path.startsWith("/api/")) return originalFetch(input, init);
  const method = init?.method ?? "GET";
  requests.push({ path, method });
  const json = (data: unknown) => new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
  if (method === "POST" && path.endsWith("/deactivate")) { active = false; return json({ success: true, data: { id: "synthetic-profile", isActive: false } }); }
  if (method !== "GET") throw new Error("Unsupported synthetic mutation");
  if (path === "/api/auth/session") return json({ authenticated: true, user: { id: "synthetic-admin", role: "admin", isAdmin: true } });
  if (path === "/api/printer-profiles") return json({ success: true, data: [{ id: "synthetic-profile", displayName: "Synthetic label printer", printerType: "shipping_label", intendedUse: "shipping_label", isActive: active, isDefault: false, scope: "organization", supportedDocuments: ["ups_label"] }] });
  if (path === "/api/organization/preferences") return json({});
  if (path === "/api/orders/deadline-context") return json({ timezone: "America/Indiana/Indianapolis" });
  if (path === "/api/customers") return json([{ id: "synthetic-customer", companyName: "Synthetic Print Company", status: "active", customerType: "business", contacts: [], createdAt: "2026-11-04" }]);
  if (path === "/api/prepress/queue") return json({ success: true, data: [], meta: { totalCount: 0, filteredCount: 0 } });
  return json({ success: true, data: [] });
};
Object.assign(window, { __usabilityRequests: () => requests });

function Fixture() {
  const { setTheme } = useTheme();
  const [date, setDate] = useState("2026-11-10");
  const [deadline, setDeadline] = useState<OrderDeadline | null>(dateOnlyDeadline(date));
  const view = new URLSearchParams(location.search).get("view");
  return <div className="min-h-screen bg-background text-foreground">
    <nav className="flex gap-3 p-2 text-xs"><span>Synthetic usability · mocked HTTP</span><button onClick={() => setTheme("light")}>Light</button><button onClick={() => setTheme("dark")}>Dark</button></nav>
    {view === "customers" ? <Customers /> : view === "prepress" ? <Prepress /> : view === "printers" ? <div className="p-3"><PrinterSettingsPage /></div> : <div className="space-y-4 p-4">
      <div className="w-[220px] rounded border bg-card p-3" data-testid="deadline-example"><OrderDueDateField id="due" value={date} onChange={setDate} deadline={deadline} onDeadlineChange={setDeadline} /></div>
      <PrinterPicker printer={{ profiles: [], isLoading: false, selectedProfile: null, selectedProfileId: null, selectPrinterProfile: () => {} } as any} />
    </div>}
  </div>;
}
createRoot(document.getElementById("root")!).render(<ThemeProvider><QueryClientProvider client={queryClient}><BrowserRouter><NavigationGuardProvider><TooltipProvider><Fixture /></TooltipProvider></NavigationGuardProvider></BrowserRouter></QueryClientProvider></ThemeProvider>);
