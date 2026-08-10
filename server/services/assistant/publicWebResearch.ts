import { lookup as dnsLookup } from "node:dns/promises";
import * as http from "node:http";
import * as https from "node:https";
import * as net from "node:net";
import { z } from "zod";
import type { AssistantOperatorSemanticTool } from "./operatorToolExecutor";

const MAX_REDIRECTS = 3;
const MAX_RESPONSE_BYTES = 1_000_000;
const MAX_EXTRACTED_TEXT = 30_000;
const REQUEST_TIMEOUT_MS = 8_000;
const searchInput = z.object({ query: z.string().trim().min(2).max(300), limit: z.number().int().min(1).max(8).default(5) }).strict();
const openInput = z.object({ url: z.string().trim().url().max(2_000) }).strict();

type Lookup = (host: string) => Promise<Array<{ address: string; family: number }>>;
type Request = (url: URL, address: string) => Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: Buffer }>;

function isPublicAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 4) {
    const [a, b] = address.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 0 || b === 168)) || (a === 198 && (b === 18 || b === 19)));
  }
  if (family === 6) {
    const normalized = address.toLowerCase();
    return !(normalized === "::" || normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb") || normalized.startsWith("::ffff:127.") || normalized.startsWith("::ffff:10.") || normalized.startsWith("::ffff:192.168."));
  }
  return false;
}

async function resolvePublicUrl(rawUrl: string, lookup: Lookup): Promise<{ url: URL; address: string }> {
  const url = new URL(rawUrl);
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password || (url.port && url.port !== "80" && url.port !== "443")) throw new Error("Unsafe public web destination.");
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) throw new Error("Unsafe public web destination.");
  if (net.isIP(host)) {
    if (!isPublicAddress(host)) throw new Error("Unsafe public web destination.");
    return { url, address: host };
  }
  const addresses = await lookup(host);
  const selected = addresses.find((item) => isPublicAddress(item.address));
  if (!selected || addresses.some((item) => !isPublicAddress(item.address))) throw new Error("Unsafe public web destination.");
  return { url, address: selected.address };
}

function publicLookup(host: string): Promise<Array<{ address: string; family: number }>> {
  return dnsLookup(host, { all: true, verbatim: true });
}

function requestPinned(url: URL, address: string): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  const client = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const request = client.request(url, {
      method: "GET",
      headers: { Accept: "text/html, text/plain, application/json;q=0.8", "User-Agent": "PrintersHero-OperatorResearch/1.0" },
      lookup: (_hostname, _options, callback) => callback(null, address, net.isIP(address)),
    }, (response) => {
      const chunks: Buffer[] = []; let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_RESPONSE_BYTES) { request.destroy(new Error("Public page response exceeded the safe size limit.")); return; }
        chunks.push(chunk);
      });
      response.on("end", () => resolve({ statusCode: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks) }));
    });
    request.setTimeout(REQUEST_TIMEOUT_MS, () => request.destroy(new Error("Public page request timed out.")));
    request.on("error", reject);
    request.end();
  });
}

function textFromHtml(input: string): { title: string | null; text: string; truncated: boolean } {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(input)?.[1]?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() ?? null;
  const text = input.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim();
  return { title, text: text.slice(0, MAX_EXTRACTED_TEXT), truncated: text.length > MAX_EXTRACTED_TEXT };
}

function containsHighRiskEgress(value: string): boolean {
  return /(?:-----BEGIN [A-Z ]+-----|\b(?:api[_-]?key|authorization|bearer|password|secret|token)\b\s*[:=]|\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b|\b\d{3}[-.)\s]\d{3}[-\s]\d{4}\b)/i.test(value);
}

export class PublicWebResearchClient {
  constructor(private readonly lookup: Lookup = publicLookup, private readonly request: Request = requestPinned) {}

  async open(rawUrl: string) {
    let candidate = rawUrl;
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
      const { url, address } = await resolvePublicUrl(candidate, this.lookup);
      const response = await this.request(url, address);
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        const location = response.headers.location;
        if (!location || redirects === MAX_REDIRECTS) throw new Error("Public page redirect limit reached.");
        candidate = new URL(location, url).toString();
        continue;
      }
      if (response.statusCode < 200 || response.statusCode >= 300) throw new Error(`Public page returned HTTP ${response.statusCode}.`);
      const contentType = String(response.headers["content-type"] ?? "").toLowerCase();
      if (!/^(text\/html|text\/plain|application\/json)(?:;|$)/.test(contentType)) throw new Error("Public page content type is not supported.");
      const raw = response.body.toString("utf8");
      const extracted = contentType.startsWith("text/html") ? textFromHtml(raw) : { title: null, text: raw.slice(0, MAX_EXTRACTED_TEXT), truncated: raw.length > MAX_EXTRACTED_TEXT };
      return { url: url.toString(), domain: url.hostname, contentType, ...extracted, redirects };
    }
    throw new Error("Public page could not be opened safely.");
  }
}

export function isPublicWebResearchConfigured(): boolean {
  return Boolean(process.env.PUBLIC_WEB_SEARCH_API_KEY?.trim());
}

function searchConfigured(): { endpoint: string; key: string } | null {
  const key = process.env.PUBLIC_WEB_SEARCH_API_KEY?.trim();
  if (!key) return null;
  return { endpoint: process.env.PUBLIC_WEB_SEARCH_ENDPOINT?.trim() || "https://api.search.brave.com/res/v1/web/search", key };
}

export function createPublicWebResearchTools(client = new PublicWebResearchClient()): AssistantOperatorSemanticTool[] {
  return [{
    name: "web.search",
    description: "Search the public web using a concise public query. Arguments: query and optional limit up to 8. Returns public source titles, URLs, domains, and snippets. Never include private customer, invoice, contact, token, or internal-note data in a query.",
    async execute({ arguments: args }) {
      const input = searchInput.parse(args);
      if (containsHighRiskEgress(input.query)) return { status: "rejected", warning: "The public search query contains sensitive-looking private data." };
      const config = searchConfigured();
      if (!config) return { status: "failed", warning: "Public web search is not configured for this environment." };
      const endpoint = new URL(config.endpoint); endpoint.searchParams.set("q", input.query); endpoint.searchParams.set("count", String(input.limit));
      const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const response = await fetch(endpoint, { headers: { Accept: "application/json", "X-Subscription-Token": config.key }, signal: controller.signal });
        if (!response.ok) return { status: "failed", warning: "The configured public search provider was unavailable." };
        const body: any = await response.json();
        const results = (body?.web?.results ?? []).slice(0, input.limit).flatMap((item: any) => {
          try { const url = new URL(String(item.url)); return url.protocol === "https:" || url.protocol === "http:" ? [{ title: String(item.title ?? url.hostname).slice(0, 300), url: url.toString(), domain: url.hostname, snippet: String(item.description ?? "").slice(0, 1_000) }] : []; } catch { return []; }
        });
        return { status: "succeeded", result: { status: "succeeded", data: { query: input.query, results, sourceType: "public_web", retrievedAt: new Date().toISOString() }, provenance: { sourceLinks: [], freshness: { capturedAt: new Date().toISOString(), label: "public web search" } } } as any };
      } catch { return { status: "failed", warning: "The configured public search provider was unavailable." }; } finally { clearTimeout(timeout); }
    },
  }, {
    name: "web.open",
    description: "Open and extract bounded readable content from a public http/https URL, normally one returned by web.search. Argument: url. Private networks, localhost, credentials, unsafe schemes, redirects to unsafe addresses, scripts, cookies, and authentication are not available.",
    async execute({ arguments: args }) {
      const input = openInput.parse(args);
      try { const page = await client.open(input.url); return { status: "succeeded", result: { status: "succeeded", data: { ...page, sourceType: "public_web", retrievedAt: new Date().toISOString() }, provenance: { sourceLinks: [], freshness: { capturedAt: new Date().toISOString(), label: "public web page" } } } as any }; }
      catch (error) { return { status: "rejected", warning: error instanceof Error ? error.message : "Public page could not be opened safely." }; }
    },
  }];
}
