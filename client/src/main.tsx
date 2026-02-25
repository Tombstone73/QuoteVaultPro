import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./index.css";
import { checkApiConfig, getApiUrl, isApiRequestUrl } from "./lib/apiConfig";
import { ConfigError } from "./components/ConfigError";

function installApiCredentialsFetchDefaults(): void {
  if (typeof window === "undefined") return;

  const globalWindow = window as Window & { __titanApiFetchCredentialsPatch?: boolean };
  if (globalWindow.__titanApiFetchCredentialsPatch) return;

  const nativeFetch = window.fetch.bind(window);

  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    let requestUrl = "";

    if (typeof input === "string") {
      requestUrl = input;
      if (requestUrl.startsWith("/api") || requestUrl === "/api") {
        requestUrl = getApiUrl(requestUrl);
      }
      if (isApiRequestUrl(requestUrl)) {
        return nativeFetch(requestUrl, { ...init, credentials: init?.credentials ?? "include" });
      }
      return nativeFetch(requestUrl, init);
    }

    if (input instanceof URL) {
      requestUrl = input.toString();
      if (isApiRequestUrl(requestUrl)) {
        return nativeFetch(requestUrl, { ...init, credentials: init?.credentials ?? "include" });
      }
      return nativeFetch(input, init);
    }

    requestUrl = input.url;
    if (isApiRequestUrl(requestUrl)) {
      const patchedRequest = new Request(input, {
        credentials: init?.credentials ?? input.credentials ?? "include",
        ...init,
      });
      return nativeFetch(patchedRequest);
    }

    return nativeFetch(input, init);
  };

  globalWindow.__titanApiFetchCredentialsPatch = true;
}

installApiCredentialsFetchDefaults();

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
