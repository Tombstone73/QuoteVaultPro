import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./index.css";
import { checkApiConfig } from "./lib/apiConfig";
import { ConfigError } from "./components/ConfigError";

const container = document.getElementById("root");

if (container) {
  // Check API configuration before rendering app
  const configCheck = checkApiConfig();
  
  if (!configCheck.isValid) {
    // Show configuration error instead of crashing
    createRoot(container).render(
      <ConfigError error={configCheck.error || "Unknown configuration error"} />
    );
  } else {
    // Config is valid, render app normally
    createRoot(container).render(
      <BrowserRouter>
        <App />
      </BrowserRouter>
    );
  }
}
