type Json = Record<string, any>;

type Finding = {
  severity: "ERROR" | "WARNING" | "INFO";
  code: string;
  message: string;
  path: string;
  entityId?: string;
};

type Envelope<T> =
  | { success: true; data?: T; requiresWarningsConfirm?: boolean; findings?: Finding[]; message?: string }
  | { success: false; message?: string; findings?: Finding[] };

function argValue(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

function usageAndExit(msg?: string): never {
  if (msg) console.error(`[pbv2:http:smoke] ${msg}`);
  console.error("Usage:");
  console.error("  tsx scripts/pbv2-http-smoke.ts --productId <id> [--baseUrl http://localhost:5000] [--cookie 'connect.sid=...']");
  console.error("\nAuth:");
  console.error("  - This repo uses session cookies. Get it from DevTools > Application > Cookies (connect.sid).\n");
  process.exit(2);
}

function ensure(condition: any, msg: string): asserts condition {
  if (!condition) throw new Error(msg);
}

async function readJson(res: Response): Promise<any> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function http(baseUrl: string, path: string, opts: { method: string; cookie?: string; body?: any }) {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.cookie) headers["Cookie"] = opts.cookie;

  const res = await fetch(`${baseUrl}${path}`, {
    method: opts.method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });

  const json = await readJson(res);
  return { res, json };
}

async function main() {
  const productId = argValue("--productId") ?? argValue("-p");
  if (!productId) usageAndExit("Missing --productId");

  const baseUrl = argValue("--baseUrl") ?? "http://localhost:5000";
  const cookie = argValue("--cookie") ?? process.env.PBV2_COOKIE;

  console.log(`[pbv2:http:smoke] baseUrl=${baseUrl}`);
  console.log(`[pbv2:http:smoke] productId=${productId}`);

  // Starter tree must be publish-valid.
  const { createPbv2StarterTreeJson } = await import("../shared/pbv2/starterTree");
  const starterTree = createPbv2StarterTreeJson() as Json;

  // 1) Create draft
  console.log("PASS?: POST /draft");
  const draftCreate = await http(baseUrl, `/api/products/${productId}/pbv2/tree/draft`, {
    method: "POST",
    cookie,
    body: {},
  });

  if (draftCreate.res.status === 401) {
    console.log("FAIL: Unauthorized (401). Provide --cookie 'connect.sid=...'");
    process.exit(1);
  }

  ensure(draftCreate.res.ok, `Create draft failed: ${draftCreate.res.status} ${JSON.stringify(draftCreate.json)}`);
  ensure((draftCreate.json as any)?.success === true, `Create draft bad response: ${JSON.stringify(draftCreate.json)}`);
  console.log("PASS: draft created (or already existed)");

  // 2) Get tree versions
  console.log("PASS?: GET /tree");
  const tree1 = await http(baseUrl, `/api/products/${productId}/pbv2/tree`, { method: "GET", cookie });
  ensure(tree1.res.ok, `Get tree failed: ${tree1.res.status} ${JSON.stringify(tree1.json)}`);
  const draft = (tree1.json as any)?.data?.draft;
  ensure(draft?.id, `No draft returned: ${JSON.stringify(tree1.json)}`);
  console.log(`PASS: draft id=${draft.id}`);

  // 3) Patch draft with starter tree
  console.log("PASS?: PATCH draft treeJson");
  const patch = await http(baseUrl, `/api/pbv2/tree-versions/${draft.id}`, {
    method: "PATCH",
    cookie,
    body: { treeJson: starterTree },
  });
  ensure(patch.res.ok, `Patch draft failed: ${patch.res.status} ${JSON.stringify(patch.json)}`);
  ensure((patch.json as any)?.success === true, `Patch draft bad response: ${JSON.stringify(patch.json)}`);
  console.log("PASS: draft patched with starter tree");

  // 4) Publish (handle warnings confirmation)
  console.log("PASS?: POST publish");
  const publish1 = await http(baseUrl, `/api/pbv2/tree-versions/${draft.id}/publish`, { method: "POST", cookie, body: {} });
  ensure(publish1.res.ok, `Publish failed: ${publish1.res.status} ${JSON.stringify(publish1.json)}`);

  const p1 = publish1.json as Envelope<any>;
  if ((p1 as any)?.requiresWarningsConfirm) {
    console.log("PASS: publish requires warnings confirmation; confirming...");
    const publish2 = await http(baseUrl, `/api/pbv2/tree-versions/${draft.id}/publish?confirmWarnings=true`, {
      method: "POST",
      cookie,
      body: {},
    });
    ensure(publish2.res.ok, `Publish confirm failed: ${publish2.res.status} ${JSON.stringify(publish2.json)}`);
    ensure((publish2.json as any)?.success === true, `Publish confirm bad response: ${JSON.stringify(publish2.json)}`);
    console.log("PASS: published with confirmWarnings=true");
  } else {
    ensure((publish1.json as any)?.success === true, `Publish bad response: ${JSON.stringify(publish1.json)}`);
    console.log("PASS: published");
  }

  // 5) Confirm active exists
  console.log("PASS?: GET /tree (confirm active)");
  const tree2 = await http(baseUrl, `/api/products/${productId}/pbv2/tree`, { method: "GET", cookie });
  ensure(tree2.res.ok, `Get tree 2 failed: ${tree2.res.status} ${JSON.stringify(tree2.json)}`);
  const active = (tree2.json as any)?.data?.active;
  ensure(active?.id, `No active returned: ${JSON.stringify(tree2.json)}`);
  console.log(`PASS: active id=${active.id}`);

  console.log("[pbv2:http:smoke] OK");
}

main().catch((e: any) => {
  console.error("[pbv2:http:smoke] FAIL:", e?.message || e);
  process.exit(1);
});
