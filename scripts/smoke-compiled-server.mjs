import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import http from "node:http";
import { fileURLToPath } from "node:url";

const entrypoint = new URL("../dist/index.js", import.meta.url);
const entrypointPath = fileURLToPath(entrypoint);
if (!existsSync(entrypointPath)) {
  throw new Error("dist/index.js is missing. Run npm run build before smoke:compiled-server.");
}

const port = 52_000 + Math.floor(Math.random() * 2_000);
const baseUrl = `http://127.0.0.1:${port}`;
const frontendOrigin = "https://www.printershero.com";
const child = spawn(process.execPath, [entrypointPath], {
  env: {
    ...process.env,
    NODE_ENV: "production",
    PORT: String(port),
    DATABASE_URL: "postgresql://smoke:smoke@127.0.0.1:1/smoke",
    DRIZZLE_AUTO_MIGRATE: "0",
    SESSION_SECRET: "compiled-server-smoke-session-secret-0123456789",
    APP_PUBLIC_WEB_ORIGIN: frontendOrigin,
    WORKERS_ENABLED: "false",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let output = "";
child.stdout.on("data", (chunk) => { output += chunk.toString(); });
child.stderr.on("data", (chunk) => { output += chunk.toString(); });

function request(path, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(`${baseUrl}${path}`, options, (res) => {
      res.resume();
      res.on("end", () => resolve(res));
    });
    req.on("error", reject);
    req.end();
  });
}

async function waitForReady() {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (output.includes("[Server] Ready to accept connections")) return;
    if (child.exitCode !== null) throw new Error(`Compiled server exited before ready:\n${output}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Compiled server did not become ready:\n${output}`);
}

try {
  await waitForReady();

  const health = await request("/api/health");
  if (health.statusCode !== 200) throw new Error(`/api/health expected 200, got ${health.statusCode}`);

  const authConfig = await request("/api/auth/config");
  if (authConfig.statusCode !== 200) throw new Error(`/api/auth/config expected 200, got ${authConfig.statusCode}`);

  const preflight = await request("/api/auth/login", {
    method: "OPTIONS",
    headers: { Origin: frontendOrigin, "Access-Control-Request-Method": "POST" },
  });
  if (![200, 204].includes(preflight.statusCode) || preflight.headers["access-control-allow-origin"] !== frontendOrigin) {
    throw new Error(`Auth preflight failed: status=${preflight.statusCode} origin=${preflight.headers["access-control-allow-origin"]}`);
  }

  const report = await request("/api/reports/daily-production", { headers: { Origin: frontendOrigin } });
  if (report.statusCode !== 401) throw new Error(`/api/reports/daily-production expected protected 401, got ${report.statusCode}`);

  console.log("Compiled server smoke passed: health, auth config, production-origin preflight, and protected report route are reachable.");
} catch (error) {
  console.error(output);
  throw error;
} finally {
  child.kill();
}
