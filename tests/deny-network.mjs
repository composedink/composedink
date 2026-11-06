import net from "node:net";
import { syncBuiltinESMExports } from "node:module";
const allowed = process.env.COMPOSED_ALLOW_HOST;
function allows(host, port) {
  if (!allowed || !host) return false;
  const target = new URL(`http://${allowed}`);
  const targetPort = /:(\d+)$/.exec(allowed)?.[1];
  return host === target.hostname && (!targetPort || String(port) === targetPort);
}
const connect = Reflect.get(net.Socket.prototype, "connect");
net.Socket.prototype.connect = function (...args) {
  const options = Array.isArray(args[0]) ? args[0] : args;
  const first = options[0];
  const port = first && typeof first === "object" ? first.port : first;
  const host =
    first && typeof first === "object"
      ? first.host
      : typeof options[1] === "string"
        ? options[1]
        : undefined;
  if (allows(host, port)) return Reflect.apply(connect, this, args);
  if (String(port) === process.env.COMPOSED_DENY_PORT)
    throw Error("Host build attempted artifact-server connection");
  if (host && !["localhost", "127.0.0.1", "::1"].includes(host))
    throw Error(`Host build attempted outgoing network: ${host}`);
  return Reflect.apply(connect, this, args);
};
syncBuiltinESMExports();
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (allows(url.hostname, url.port || (url.protocol === "https:" ? "443" : "80")))
    return originalFetch(input, init);
  if (url.port === process.env.COMPOSED_DENY_PORT)
    throw Error("Host build attempted artifact fetch");
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    throw Error(`Host build attempted fetch: ${url}`);
  return originalFetch(input, init);
};
