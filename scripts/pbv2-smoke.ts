type Json = Record<string, any>;

export {};

type Finding = {
  severity: "ERROR" | "WARNING" | "INFO";
  code: string;
  message: string;
  path: string;
  entityId?: string;
};

function argValue(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

function usageAndExit(msg?: string): never {
  if (msg) console.error(`[pbv2-smoke] ${msg}`);
  console.error("Usage:");
  console.error("  tsx scripts/pbv2-smoke.ts --productId <id> [--baseUrl http://localhost:5000] [--cookie 'connect.sid=...']");
  console.error("\nNotes:");
  console.error("  - This uses your existing session cookie (no new auth).\n  - Get cookie from DevTools > Application > Cookies (connect.sid).\n  - Server must be running (npm run dev).\n");
  process.exit(2);
}

async function readJson(res: Response): Promise<any> {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return { raw: text };
  }
}

async function http(baseUrl: string, path: string, opts: { method: string; cookie?: string; body?: any }) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.cookie) headers["Cookie"] = opts.cookie;

  const res = await fetch(`${baseUrl}${path}`, {
    method: opts.method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });

  const json = await readJson(res);
  return { res, json };
}

function ensure(condition: any, msg: string): asserts condition {
  if (!condition) {
    throw new Error(msg);
  }
}

function minimalValidTreeWithWarning(): Json {
  // Minimal publishable PBV2 tree according to current validator expectations (see shared/pbv2/tests/validator/validatePublish.test.ts)
  // Includes one unreachable node to intentionally produce a WARNING.
  return {
    status: "DRAFT",
    rootNodeIds: ["root"],
    nodes: [
      {
        id: "root",
        type: "INPUT",
        status: "ENABLED",
        key: "root",
        input: { selectionKey: "root", valueType: "BOOLEAN" },
      },
      {
        id: "orphan",
        type: "INPUT",
        status: "ENABLED",
        key: "orphan",
        input: { selectionKey: "orphan", valueType: "BOOLEAN" },
      },
    ],
    edges: [],
  };
}

async function main() {
  const productId = argValue("--productId") ?? argValue("-p");
  if (!productId) usageAndExit("Missing --productId");

  const baseUrl = argValue("--baseUrl") ?? "http://localhost:5000";
  const cookie = argValue("--cookie") ?? process.env.PBV2_COOKIE;
  if (!cookie) usageAndExit("Missing --cookie (or env PBV2_COOKIE)");

  console.log(`[pbv2-smoke] baseUrl=${baseUrl}`);
  console.log(`[pbv2-smoke] productId=${productId}`);

  // 1) Create draft
  console.log("[pbv2-smoke] POST draft");
  const draftCreate = await http(baseUrl, `/api/products/${productId}/pbv2/tree/draft`, { method: "POST", cookie, body: {} });
  ensure(draftCreate.res.ok, `Create draft failed: ${draftCreate.res.status} ${JSON.stringify(draftCreate.json)}`);
  ensure(draftCreate.json?.success === true, `Create draft bad response: ${JSON.stringify(draftCreate.json)}`);

  // 2) Get tree versions
  console.log("[pbv2-smoke] GET tree versions");
  const tree1 = await http(baseUrl, `/api/products/${productId}/pbv2/tree`, { method: "GET", cookie });
  ensure(tree1.res.ok, `Get tree failed: ${tree1.res.status} ${JSON.stringify(tree1.json)}`);
  const draft = tree1.json?.data?.draft;
  ensure(draft?.id, `No draft returned: ${JSON.stringify(tree1.json)}`);

  // 3) Patch draft with a minimal valid treeJson (with warnings)
  console.log("[pbv2-smoke] PATCH draft treeJson (valid + warning)" );
  const patch = await http(baseUrl, `/api/pbv2/tree-versions/${draft.id}`, {
    method: "PATCH",
    cookie,
    body: { treeJson: minimalValidTreeWithWarning() },
  });
  ensure(patch.res.ok, `Patch draft failed: ${patch.res.status} ${JSON.stringify(patch.json)}`);
  ensure(patch.json?.success === true, `Patch draft bad response: ${JSON.stringify(patch.json)}`);

  // 4) Publish without confirmWarnings; should require confirm because we intentionally include a warning.
  console.log("[pbv2-smoke] POST publish (expect requiresWarningsConfirm)" );
  const publish1 = await http(baseUrl, `/api/pbv2/tree-versions/${draft.id}/publish`, { method: "POST", cookie, body: {} });
  ensure(publish1.res.ok, `Publish step 1 failed: ${publish1.res.status} ${JSON.stringify(publish1.json)}`);
  ensure(
    publish1.json?.requiresWarningsConfirm === true,
    `Expected requiresWarningsConfirm=true but got: ${JSON.stringify(publish1.json)}`
  );

  // 5) Publish with confirmWarnings=true; should succeed and set ACTIVE
  console.log("[pbv2-smoke] POST publish?confirmWarnings=true" );
  const publish2 = await http(baseUrl, `/api/pbv2/tree-versions/${draft.id}/publish?confirmWarnings=true`, {
    method: "POST",
    cookie,
    body: {},
  });
  ensure(publish2.res.ok, `Publish step 2 failed: ${publish2.res.status} ${JSON.stringify(publish2.json)}`);
  ensure(publish2.json?.success === true, `Publish step 2 bad response: ${JSON.stringify(publish2.json)}`);
  ensure(publish2.json?.data?.status === "ACTIVE", `Expected ACTIVE, got: ${JSON.stringify(publish2.json?.data)}`);

  // 6) Get tree versions; confirm active exists
  console.log("[pbv2-smoke] GET tree versions (confirm active)" );
  const tree2 = await http(baseUrl, `/api/products/${productId}/pbv2/tree`, { method: "GET", cookie });
  ensure(tree2.res.ok, `Get tree 2 failed: ${tree2.res.status} ${JSON.stringify(tree2.json)}`);
  const active = tree2.json?.data?.active;
  ensure(active?.id, `No active returned: ${JSON.stringify(tree2.json)}`);

  // 7) Prove errors block publishing by creating a new draft and trying to publish without roots.
  console.log("[pbv2-smoke] POST draft (new)" );
  const draftCreate2 = await http(baseUrl, `/api/products/${productId}/pbv2/tree/draft`, { method: "POST", cookie, body: {} });
  ensure(draftCreate2.res.ok, `Create draft 2 failed: ${draftCreate2.res.status} ${JSON.stringify(draftCreate2.json)}`);

  const tree3 = await http(baseUrl, `/api/products/${productId}/pbv2/tree`, { method: "GET", cookie });
  ensure(tree3.res.ok, `Get tree 3 failed: ${tree3.res.status} ${JSON.stringify(tree3.json)}`);
  const draft2 = tree3.json?.data?.draft;
  ensure(draft2?.id, `No new draft returned: ${JSON.stringify(tree3.json)}`);

  console.log("[pbv2-smoke] POST publish (expect 400 errors)" );
  const publishBad = await http(baseUrl, `/api/pbv2/tree-versions/${draft2.id}/publish`, { method: "POST", cookie, body: {} });
  ensure(publishBad.res.status === 400, `Expected 400 for invalid draft, got: ${publishBad.res.status} ${JSON.stringify(publishBad.json)}`);
  const findings = (publishBad.json?.findings ?? []) as Finding[];
  ensure(findings.length > 0, `Expected findings for invalid publish: ${JSON.stringify(publishBad.json)}`);

  console.log("[pbv2-smoke] OK: draft→publish lifecycle works." );
}

main().catch((e: any) => {
  console.error("[pbv2-smoke] FAIL:", e?.message || e);
  process.exit(1);
});
