import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./index.css";
import { apiUrl, checkApiConfig, objectsUrl } from "./lib/apiConfig";
import { ConfigError } from "./components/ConfigError";

function resolveFetchUrl(url: string): string {
  if (url.startsWith("/api") || url === "/api") {
    return apiUrl(url);
  }
  if (url.startsWith("/objects") || url === "/objects") {
    return objectsUrl(url);
  }
  return url;
}

function installUrlAwareFetch(): void {
  if (typeof window === "undefined") return;
  const globalWindow = window as Window & { __titanUrlAwareFetchInstalled?: boolean };
  if (globalWindow.__titanUrlAwareFetchInstalled) return;

  const originalFetch = window.fetch.bind(window);

  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input === "string") {
      return originalFetch(resolveFetchUrl(input), init);
    }
    if (input instanceof URL) {
      return originalFetch(resolveFetchUrl(input.toString()), init);
    }
    if (input instanceof Request) {
      const rewrittenUrl = resolveFetchUrl(input.url);
      if (rewrittenUrl !== input.url) {
        const rewrittenRequest = new Request(rewrittenUrl, input);
        return originalFetch(rewrittenRequest, init);
      }
    }
    return originalFetch(input, init);
  };

  globalWindow.__titanUrlAwareFetchInstalled = true;
}

installUrlAwareFetch();

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
