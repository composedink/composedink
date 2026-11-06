import { parentPort } from "node:worker_threads";
import { lintWorker } from "./worker.ts";
if (!parentPort) throw Error("Lint worker requires parentPort");
parentPort.on(
  "message",
  lintWorker((reply) => parentPort?.postMessage(reply)),
);
