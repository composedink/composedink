import { lintWorker, type LintRequest } from "@composedink/lint/worker";
const receive = lintWorker((reply) => postMessage(reply));
self.onmessage = (event: MessageEvent<LintRequest>) => receive(event.data);
