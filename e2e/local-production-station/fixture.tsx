import React from "react";
import { ThemeProvider } from "@/hooks/useTheme";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { NavigationGuardProvider } from "@/contexts/NavigationGuardContext";
import { TooltipProvider } from "@/components/ui/tooltip";
import TitanSidebarNav from "@/components/layout/TitanSidebarNav";
import ProductionBoard from "@/pages/production";
import "../../client/src/index.css";

createRoot(document.getElementById("root")!).render(
  <ThemeProvider><QueryClientProvider client={queryClient}><BrowserRouter><NavigationGuardProvider><TooltipProvider>
    <div className="flex"><TitanSidebarNav /><main className="min-w-0 flex-1">
      <p>Local test fixture — mocked APIs, no database connection</p>
      <button onClick={() => queryClient.invalidateQueries()}>Refetch fixture queries</button>
      <ProductionBoard />
    </main></div>
  </TooltipProvider></NavigationGuardProvider></BrowserRouter></QueryClientProvider></ThemeProvider>,
);
