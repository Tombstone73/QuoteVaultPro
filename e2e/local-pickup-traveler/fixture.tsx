import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, Link } from "react-router-dom";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import OrderTravelerPage from "@/pages/order-traveler";
import FulfillmentWorkspace from "@/pages/fulfillment-workspace";
import "../../client/src/index.css";

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={new QueryClient()}><BrowserRouter>
    <Routes><Route path="/orders/:orderId/traveler" element={<OrderTravelerPage />} />
      <Route path="/fulfillment/orders/:orderId" element={<><div className="p-2 text-sm">Local mock workflow — no database or physical printing. <Link to="/orders/fixture-20538/traveler?directPrintJobId=latest">View latest Traveler</Link></div><FulfillmentWorkspace /></>} />
    </Routes>
  </BrowserRouter></QueryClientProvider>,
);
