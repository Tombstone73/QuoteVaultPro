import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import OrderTravelerPage from "@/pages/order-traveler";
import "../../client/src/index.css";

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={new QueryClient()}><BrowserRouter>
    <Routes><Route path="/orders/:orderId/traveler" element={<OrderTravelerPage />} /></Routes>
  </BrowserRouter></QueryClientProvider>,
);
