import { expectedApiOriginForWebHost } from "@shared/deploymentOrigins";
import { getPublicWebOrigin } from "./appRuntimeConfig";

export const INBOUND_GMAIL_CALLBACK_PATH = "/api/inbound-orders/email/mailboxes/gmail/callback";

function httpUrl(value: string): URL {
  const url = new URL(value);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(local && url.protocol === "http:")) || url.username || url.password || url.search || url.hash) {
    throw new Error("Invalid inbound Gmail public URL configuration");
  }
  return url;
}

export function inboundGmailWebOrigin(req: any): string {
  // APP_PUBLIC_WEB_ORIGIN is the existing runtime contract; APP_URL supports
  // older installations. Neither is used as a callback/backend origin.
  return httpUrl(getPublicWebOrigin() ?? process.env.APP_URL ?? `${req.protocol}://${req.get("host")}`).origin;
}

export function getInboundGmailRedirectUri(req: any): string {
  const web = new URL(inboundGmailWebOrigin(req));
  const expectedApi = expectedApiOriginForWebHost(web.hostname);
  const explicit = process.env.GOOGLE_INBOUND_OAUTH_REDIRECT_URI?.trim();
  const callback = httpUrl(explicit || `${expectedApi ?? `${req.protocol}://${req.get("host")}`}${INBOUND_GMAIL_CALLBACK_PATH}`);
  if (callback.pathname !== INBOUND_GMAIL_CALLBACK_PATH || (expectedApi && callback.origin !== expectedApi)) {
    throw new Error("Inbound Gmail callback must use this environment's backend origin");
  }
  return callback.toString();
}

export function getEmailSettingsRedirectUrl(req: any, query?: string): string {
  return `${inboundGmailWebOrigin(req)}/settings/email${query ? `?${query}` : ""}`;
}
