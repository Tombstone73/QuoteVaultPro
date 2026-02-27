import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./index.css";
import { checkApiConfig, resolveAppRequestUrl } from "./lib/apiConfig";
import { ConfigError } from "./components/ConfigError";

function resolveFetchUrl(url: string): string {
  return resolveAppRequestUrl(url, window.location.origin);
}

function installUrlAwareFetch(): void {
  if (typeof window === "undefined") return;

  const globalWindow = window as Window & {
    __titanUrlAwareFetchInstalled?: boolean;
  };

  if (globalWindow.__titanUrlAwareFetchInstalled) return;

  const originalFetch = window.fetch.bind(window);

  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    let finalInput: RequestInfo | URL = input;

    if (typeof input === "string") {
      finalInput = resolveFetchUrl(input);
    } else if (input instanceof URL) {
      finalInput = resolveFetchUrl(input.toString());
    } else if (input instanceof Request) {
      const rewrittenUrl = resolveFetchUrl(input.url);
      if (rewrittenUrl !== input.url) {
        finalInput = new Request(rewrittenUrl, input);
      }
    }

    return originalFetch(finalInput, {
      ...init,
      credentials: init?.credentials ?? "include",
    });
  };

  globalWindow.__titanUrlAwareFetchInstalled = true;
}

installUrlAwareFetch();

const container = document.getElementById("root");

if (container) {
  const configCheck = checkApiConfig();

  if (!configCheck.isValid) {
    createRoot(container).render(
      <ConfigError error={configCheck.error || "Unknown configuration error"} />
    );
  } else {
    createRoot(container).render(
      <BrowserRouter>
        <App />
      </BrowserRouter>
    );
  }
}