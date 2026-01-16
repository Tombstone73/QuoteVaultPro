import fs from 'fs';
import path from 'path';

function argValue(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

function usageAndExit(msg?: string, code: number = 0): never {
  if (msg) console.error(`[pdf:smoke] ${msg}`);
  console.error('Usage:');
  console.error('  tsx scripts/pdf-smoke.ts --invoiceId <id> --orgId <org> [--baseUrl http://localhost:5000] [--cookie "connect.sid=..."] [--cookieFile cookie.txt]');
  console.error('\nEnv:');
  console.error('  BASE_URL=http://localhost:5000');
  console.error('  INVOICE_ID=<id>');
  console.error('  ORG_ID=<org>');
  console.error('  COOKIE="connect.sid=..."');
  console.error('  COOKIE_FILE=cookie.txt');
  process.exit(code);
}

function ensure(condition: any, msg: string): asserts condition {
  if (!condition) throw new Error(msg);
}

function isNetscapeCookieLine(line: string): boolean {
  if (!line) return false;
  if (line.startsWith('#')) return false;
  // Netscape cookie jar format: 7 tab-separated fields
  return line.split('\t').length >= 7;
}

function cookieStringFromNetscape(text: string): string {
  const pairs: string[] = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (!isNetscapeCookieLine(line)) continue;
    const parts = line.split('\t');
    // domain, flag, path, secure, expiration, name, value
    const name = parts[5];
    const value = parts[6];
    if (!name) continue;
    pairs.push(`${name}=${value ?? ''}`);
  }
  return pairs.join('; ');
}

function readCookieFile(cookieFilePath: string): string {
  const resolved = path.resolve(cookieFilePath);
  ensure(fs.existsSync(resolved), `COOKIE_FILE not found: ${resolved}`);
  const raw = fs.readFileSync(resolved, 'utf-8').trim();
  ensure(!!raw, `COOKIE_FILE is empty: ${resolved}`);

  // Accept either:
  // - "connect.sid=...; other=..."
  // - Netscape cookie jar format
  if (raw.includes('\t') && raw.split(/\r?\n/).some((l) => isNetscapeCookieLine(l))) {
    const parsed = cookieStringFromNetscape(raw);
    ensure(!!parsed, `COOKIE_FILE did not contain any parseable cookies: ${resolved}`);
    return parsed;
  }

  return raw;
}

function looksLikeMissingProtocol(baseUrl: string): boolean {
  const raw = String(baseUrl || '').trim();
  if (!raw) return false;
  if (raw.startsWith('http://') || raw.startsWith('https://')) return false;
  // common: localhost:5000, 127.0.0.1:5000
  return raw.includes('localhost') || raw.includes('127.0.0.1') || /^\w+\.[^/]+(:\d+)?$/.test(raw) || raw.includes(':');
}

function printFetchFailureHelp(params: {
  baseUrl: string;
  invoiceId: string;
  orgId: string;
  cookie: string;
}) {
  const { baseUrl, invoiceId, orgId, cookie } = params;

  console.error('[pdf:smoke] Checklist:');
  console.error(`  1) Confirm server is running at BASE_URL (default http://localhost:5000)`);
  console.error(`  2) Confirm you are logged in + COOKIE is valid (connect.sid=...)`);
  console.error(`  3) Confirm INVOICE_ID and ORG_ID are correct`);

  if (looksLikeMissingProtocol(baseUrl)) {
    console.error(`[pdf:smoke] Hint: BASE_URL looks like it is missing a protocol. Try: http://${baseUrl.replace(/^\/+/, '')}`);
  }

  if (!cookie.includes('connect.sid')) {
    console.error('[pdf:smoke] Hint: COOKIE does not contain "connect.sid" (did you paste the right cookie string/file?)');
  }

  if (!invoiceId || invoiceId === 'undefined') {
    console.error('[pdf:smoke] Hint: invoiceId is missing/invalid');
  }
  if (!orgId || orgId === 'undefined') {
    console.error('[pdf:smoke] Hint: orgId is missing/invalid');
  }
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    usageAndExit(undefined, 0);
  }

  const invoiceId =
    argValue('--invoiceId') ??
    argValue('--invoice') ??
    argValue('-i') ??
    process.env.INVOICE_ID;

  if (!invoiceId) usageAndExit('Missing --invoiceId (or INVOICE_ID)', 2);

  const orgId = argValue('--orgId') ?? argValue('--org') ?? process.env.ORG_ID;
  if (!orgId) usageAndExit('Missing --orgId (or ORG_ID)', 2);

  const baseUrl = argValue('--baseUrl') ?? process.env.BASE_URL ?? 'http://localhost:5000';

  const directCookie = argValue('--cookie') ?? process.env.COOKIE;
  const cookieFile = argValue('--cookieFile') ?? process.env.COOKIE_FILE;

  const cookie = directCookie?.trim() ? directCookie.trim() : (cookieFile ? readCookieFile(cookieFile) : '');
  if (!cookie) usageAndExit('Missing auth cookie. Provide --cookie "connect.sid=..." or COOKIE_FILE=...', 2);

  const url = `${baseUrl.replace(/\/$/, '')}/api/invoices/${encodeURIComponent(invoiceId)}/pdf`;

  console.log(`[pdf:smoke] baseUrl=${baseUrl}`);
  console.log(`[pdf:smoke] invoiceId=${invoiceId}`);
  console.log(`[pdf:smoke] orgId=${orgId}`);

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: {
        Cookie: cookie,
        'x-organization-id': orgId,
      },
    });
  } catch (e: any) {
    console.error('[pdf:smoke] FAIL: fetch failed');
    if (e?.message) console.error(`[pdf:smoke] ${e.message}`);
    printFetchFailureHelp({ baseUrl, invoiceId, orgId, cookie });
    process.exit(1);
  }

  if (res.status === 401) {
    console.error('[pdf:smoke] FAIL: Unauthorized (401). Provide a valid session cookie.');
    process.exit(1);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error(`[pdf:smoke] FAIL: HTTP ${res.status}`);
    if (text) console.error(text.slice(0, 800));
    process.exit(1);
  }

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/pdf')) {
    const text = await res.text().catch(() => '');
    console.error(`[pdf:smoke] FAIL: Expected application/pdf but got: ${contentType || '(missing)'}`);
    if (text) console.error(text.slice(0, 800));
    process.exit(1);
  }

  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.length < 4) {
    console.error(`[pdf:smoke] FAIL: Response body too small (${buf.length} bytes)`);
    process.exit(1);
  }

  const isPdf = buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46; // %PDF
  if (!isPdf) {
    const head = Buffer.from(buf.slice(0, 16)).toString('utf-8');
    console.error(`[pdf:smoke] FAIL: Missing %PDF signature. First bytes: ${JSON.stringify(head)}`);
    process.exit(1);
  }

  console.log(`[pdf:smoke] PASS: ${buf.length} bytes, content-type=${contentType}`);
  process.exit(0);
}

main().catch((e: any) => {
  console.error('[pdf:smoke] FAIL:', e?.message || e);
  process.exit(1);
});
