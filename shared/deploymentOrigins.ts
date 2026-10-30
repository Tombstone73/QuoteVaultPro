/** Canonical web/API pairs shared by browser requests and server OAuth returns. */
export const PRODUCTION_API_ORIGIN = "https://api.printershero.com";
export const DEVELOPMENT_API_ORIGIN = "https://api-dev.printershero.com";

export function expectedApiOriginForWebHost(hostname: string | undefined): string | null {
  const host = (hostname ?? "").trim().toLowerCase();
  if (host === "printershero.com" || host === "www.printershero.com") return PRODUCTION_API_ORIGIN;
  if (host === "dev.printershero.com") return DEVELOPMENT_API_ORIGIN;
  return null;
}
