import fs from 'node:fs/promises';
import path from 'node:path';

const baseUrl = process.env.TITANOS_API_BASE_URL?.replace(/\/$/, '');
const token = process.env.TITANOS_BRIDGE_TOKEN;
const bridgeName = process.env.BRIDGE_NAME || 'Local Bridge';
const pollMs = Math.max(5, Number(process.env.POLL_INTERVAL_SECONDS || 30)) * 1000;
if (!baseUrl || !token) throw new Error('TITANOS_API_BASE_URL and TITANOS_BRIDGE_TOKEN are required');
const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
const safeName = (name) => path.basename(String(name)).replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').slice(0, 180) || 'production-file';
async function api(url, init = {}) { const res = await fetch(`${baseUrl}${url}`, { ...init, headers: { ...headers, ...init.headers } }); const body = await res.json(); if (!res.ok) throw new Error(body.error || `Bridge request failed (${res.status})`); return body.data; }
async function tick() {
  await api('/api/local-bridge/heartbeat', { method: 'POST', body: JSON.stringify({ name: bridgeName, agentVersion: '0.1.0' }) });
  const jobs = await api('/api/local-bridge/jobs');
  for (const job of jobs) {
    try { const claim = await api(`/api/local-bridge/jobs/${job.id}/claim`, { method: 'POST' }); const download = await fetch(`${baseUrl}${claim.downloadUrl}`, { headers }); if (!download.ok) throw new Error('Download failed'); if (process.env.CREATE_MISSING_DIRECTORIES === 'true') await fs.mkdir(claim.destinationPath, { recursive: true }); const target = path.join(claim.destinationPath, safeName(claim.outputFilename)); await fs.writeFile(target, Buffer.from(await download.arrayBuffer()), { flag: process.env.ALLOW_OVERWRITE === 'true' ? 'w' : 'wx' }); await api(`/api/local-bridge/jobs/${job.id}/succeeded`, { method: 'POST', body: '{}' }); }
    catch (error) { await api(`/api/local-bridge/jobs/${job.id}/failed`, { method: 'POST', body: JSON.stringify({ error: String(error.message || error) }) }).catch(() => {}); }
  }
}
setInterval(() => tick().catch(console.error), pollMs); tick().catch(console.error);
