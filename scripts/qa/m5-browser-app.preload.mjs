import net from 'node:net';
import dgram from 'node:dgram';
import { registerHooks, syncBuiltinESMExports } from 'node:module';

// No provider socket exists. Only the pinned PostgreSQL socket may leave this process.
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  const options = typeof first === 'object' ? first : { port: first, host: args[1] };
  if (options?.host !== '127.0.0.1' || Number(options.port) !== 55605) throw new Error('M5 blocked outbound TCP');
  return connect.apply(this, args);
};
dgram.createSocket = () => { throw new Error('M5 blocked UDP'); };
syncBuiltinESMExports();
registerHooks({ resolve(specifier, ctx, next) {
  if (specifier === 'dotenv/config') return { url: 'data:text/javascript,export default {}', shortCircuit: true };
  if (specifier === '@neondatabase/serverless') return { url: new URL('../../server/tests/helpers/localPostgresDriver.mjs', import.meta.url).href, shortCircuit: true };
  return next(specifier === 'drizzle-orm/neon-serverless' ? 'drizzle-orm/node-postgres' : specifier, ctx);
} });

globalThis.fetch = async (endpoint, init) => {
  if (endpoint !== process.env.PRINTERSHERO_MANAGED_AI_ENDPOINT || init?.method !== 'POST') throw new Error('M5 blocked outbound fetch');
  const body = JSON.parse(init.body);
  const p = JSON.parse(body.messages.at(-1).content);
  const call = (toolName, args) => {
    if (!p.tools?.some(t => t.name === toolName)) throw new Error('M5 requested tool not offered to this actor');
    return { kind: 'call_tools', calls: [{ toolName, arguments: args }] };
  };
  const last = p.observations?.at(-1);
  let decision;
  if (last) {
    const summary = last.result?.summary;
    const response = last.status !== 'succeeded' ? last.warning || 'The requested information could not be verified.' :
      last.toolName === 'orders.current_readiness' && summary ?
        `Current order readiness for ${last.result.orderNumber}: ${summary.actionNeededCount} action needed; ${summary.inProgressCount} in progress. ${last.result.guidance ?? ''}` :
      last.result?.response ?? JSON.stringify(last.result);
    decision = { kind: 'complete', response: response || 'No result was returned.' };
  } else if (/^why are these lights red\??$/i.test(p.goal?.trim())) decision = call('orders.current_readiness', { view: 'operational' });
  else if (/^mark line 2 production complete\.?$/i.test(p.goal?.trim())) decision = call('production.prepare_job_completion', { lineNumber: 2 });
  else if (/^what is the status of this order\??$/i.test(p.goal?.trim())) decision = call('orders.current_status', {});
  else decision = { kind: 'ask_user', question: 'Which single order line and operation do you mean?', missingInformation: ['operation'] };
  return Response.json({ model: 'synthetic-m5', choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(decision) } }] });
};

// Installed last: run identity in the environment alone is not evidence of isolation.
const tcpGuard = net.Socket.prototype.connect, udpGuard = dgram.createSocket, modelGuard = globalThis.fetch;
Object.defineProperty(globalThis, Symbol.for('ph.qa.m5.isolation'), { value: Object.freeze({
  runId: process.env.M5_RUN_ID, sourceSha: process.env.M5_SOURCE_SHA,
  active: () => net.Socket.prototype.connect === tcpGuard && dgram.createSocket === udpGuard && globalThis.fetch === modelGuard,
}) });
