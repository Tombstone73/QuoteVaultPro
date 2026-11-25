import React, { useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, useNavigate } from "react-router-dom";
import App from "@/App";
import "@/index.css";

function NavigationFixture() {
  const navigate = useNavigate();
  useLayoutEffect(() => {
    Object.assign(window, { __navigateAppFixture: navigate });
  }, [navigate]);
  return <App />;
}

createRoot(document.getElementById("root")!).render(
  <BrowserRouter><NavigationFixture /></BrowserRouter>,
);
