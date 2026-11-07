import { authority, openStore, bind } from "../../src/node.ts";
// argv: home, phase ("request" | "answer"), fault point. The answer phase arms the fault only once
// the provider is called, so the first (request) commit completes and the answer commit is killed.
const [home, phase, point] = process.argv.slice(2);
if (phase === "request") process.env.COMPOSED_FAULT = point;
else {
  const original = globalThis.fetch;
  globalThis.fetch = (...args: Parameters<typeof fetch>) => {
    process.env.COMPOSED_FAULT = point;
    return original(...args);
  };
}
const a = await authority(await openStore(home));
await bind(a)("feedback.request", {
  id: "p",
  to: ["model"],
  questions: ["Q?"],
  request: "crash",
});
