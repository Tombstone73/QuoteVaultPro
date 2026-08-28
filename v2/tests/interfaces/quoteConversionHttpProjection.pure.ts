import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../../src/interfaces/http/quoteRoutes.ts", import.meta.url), "utf8");
const accept = source.slice(source.indexOf('router.post("/:quoteId/accept"'), source.indexOf('router.post("/:quoteId/convert"'));

assert(accept.includes(".send(\n          JSON.stringify("), "acceptance must use the JSON-safe response serializer");
assert(accept.includes('typeof value === "bigint" ? value.toString() : value'), "acceptance must serialize Sales document bigint numbers as strings");
assert(!accept.includes(".json({ ok: true, data:"), "acceptance must not hand a bigint model to Express JSON serialization");
console.log("[quote-conversion-http] accepted Quote response is bigint-safe.");
