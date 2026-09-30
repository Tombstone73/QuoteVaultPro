const net = require('node:net');
const http = require('node:http');
const https = require('node:https');
const tls = require('node:tls');
const dgram = require('node:dgram');
const Module = require('node:module');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const os = require('node:os');
const { register, syncBuiltinESMExports } = require('node:module');
const mode = process.env.V2_VALIDATION_MODE || 'deterministic';
const approved = mode === 'qa' && process.env.TEST_DATABASE_URL ? new URL(process.env.TEST_DATABASE_URL) : null;
const loopback = host => ['127.0.0.1', '::1', 'localhost'].includes(host);
const tsxPipe = path.join(os.tmpdir(), `tsx-${process.geteuid ? process.geteuid() : os.userInfo().username}`, `${process.ppid}.pipe`);
const deny = () => { throw new Error('V2 validation blocked external network/provider or unapproved database I/O.'); };
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const normalized = Array.isArray(args[0]) ? args[0] : args;
  const options = typeof normalized[0] === 'object' ? normalized[0] : { port: normalized[0], host: typeof normalized[1] === 'string' ? normalized[1] : 'localhost' };
  const host = options.host || 'localhost';
  const port = String(options.port || '');
  // tsx's parent/child IPC is local, not a provider/database transport.
  if (options.path === tsxPipe || options.path === `\\\\?\\pipe\\${tsxPipe}`) return connect.apply(this, args);
  if (approved && host === approved.hostname && port === (approved.port || '5432')) return connect.apply(this, args);
  if (!loopback(host) || ['5432', '5433', '3306', '6379', '27017'].includes(port) || options.path) return deny();
  return connect.apply(this, args);
};
for (const transport of [http, https]) {
  for (const method of ['request', 'get']) {
    const original = transport[method];
    transport[method] = function (...args) {
      const input = args[0];
      const options = typeof input === 'string' || input instanceof URL ? new URL(input) : input;
      if (!loopback(options.hostname || options.host || 'localhost')) return deny();
      return original.apply(this, args);
    };
  }
}
globalThis.fetch = deny;
const tlsConnect = tls.connect;
tls.connect = function (...args) {
  const options = typeof args[0] === 'object' ? args[0] : { port: args[0], host: args[1] };
  if (!approved || options.host !== approved.hostname || String(options.port || '') !== (approved.port || '5432')) return deny();
  return tlsConnect.apply(this, args);
};
dgram.createSocket = deny;
const load = Module._load;
Module._load = function (specifier, ...args) {
  if (specifier === 'dotenv' || specifier.startsWith('dotenv/')) return require(path.join(__dirname, 'deny-dotenv.cjs'));
  const result = load.call(this, specifier, ...args);
  if ((specifier === 'pg' || specifier === '@neondatabase/serverless') && mode !== 'qa') {
    if (result.Pool) result.Pool.prototype.connect = deny;
    if (result.Client) result.Client.prototype.connect = deny;
  }
  return result;
};
register(pathToFileURL(path.join(__dirname, 'validation-loader.mjs')).href);
syncBuiltinESMExports();
