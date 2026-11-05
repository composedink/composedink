import { parentPort, workerData } from "node:worker_threads";
import vm from "node:vm";
const context = vm.createContext(vm.constants.DONT_CONTEXTIFY, {
  codeGeneration: { strings: false, wasm: false },
  microtaskMode: "afterEvaluate",
});
try {
  const value = vm.runInContext(
    `"use strict"; const props = JSON.parse(${JSON.stringify(workerData.props)}); const fallback = (${workerData.code}); const output = fallback(props); if(typeof output !== "string") throw new Error("Expected Markdown string"); output;`,
    context,
    { timeout: 1000 },
  );
  if (typeof value !== "string" || Buffer.byteLength(value) > 256 * 1024)
    throw new Error("Output exceeds 256 KiB");
  parentPort?.postMessage({ value });
} catch (error) {
  parentPort?.postMessage({ error: error instanceof Error ? error.message : "Fallback failed" });
}
