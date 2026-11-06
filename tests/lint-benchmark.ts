import { createServer } from "vite-plus";
import { chromium } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { cpus, platform, arch, release } from "node:os";
import { resolve } from "node:path";
import { longPost } from "../packages/lint/tests/long-post.ts";
const root = resolve(import.meta.dirname, "..");
await writeFile(
  resolve(root, "test-results/plan-06-blank.html"),
  "<!doctype html><title>Lint measurement</title>",
);
const server = await createServer({
  configFile: false,
  root,
  optimizeDeps: { exclude: ["harper.js"] },
  server: { port: 0 },
});
await server.listen();
const browser = await chromium.launch({ channel: "chromium" });
try {
  const page = await browser.newPage();
  await page.goto(server.resolvedUrls!.local[0] + "test-results/plan-06-blank.html");
  const result = await page.evaluate(async (text) => {
    const worker = new Worker(
      URL.createObjectURL(
        new Blob(
          [
            `import {lintWorker} from '${location.origin}/packages/lint/src/worker.ts';const receive=lintWorker(reply=>postMessage(reply));self.onmessage=e=>receive(e.data);`,
          ],
          { type: "text/javascript" },
        ),
      ),
      { type: "module" },
    );
    let id = 0;
    const run = (source: string) =>
      new Promise<{
        roundTripMs: number;
        result: { elapsedMs: number; changedParagraphs: number };
      }>((resolve, reject) => {
        const start = performance.now();
        worker.onerror = (e) => reject(Error(e.message));
        worker.onmessage = (e) => {
          if (e.data.error) reject(Error(e.data.error));
          else resolve({ roundTripMs: performance.now() - start, result: e.data.result });
        };
        worker.postMessage({ id: ++id, snapshot: { base: String(id), text: source } });
      });
    try {
      const cold = await run(text);
      const samples = [];
      for (let i = 0; i < 20; i++) {
        const changed = text.replace("The flower", i % 2 ? "The tall flower" : "The small flower");
        samples.push(await run(changed));
      }
      return { words: text.match(/\S+/g)!.length, changedParagraphWords: 26, cold, samples };
    } finally {
      worker.terminate();
    }
  }, longPost);
  await writeFile(
    resolve(root, "test-results/plan-06-latency.json"),
    JSON.stringify(
      {
        machine: { cpu: cpus()[0].model, platform: platform(), arch: arch(), release: release() },
        browser: browser.version(),
        timedSpan:
          "postMessage snapshot to worker reply; engine elapsed includes syntax masking, cache lookup, changed-paragraph Harper/style and result assembly. Cold includes worker module fetch, WASM and dictionary initialization.",
        ...result,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      words: result.words,
      coldMs: result.cold.roundTripMs,
      samples: result.samples.map((s) => ({
        roundTrip: s.roundTripMs,
        engine: s.result.elapsedMs,
        changed: s.result.changedParagraphs,
      })),
    }),
  );
} finally {
  await browser.close();
  await server.close();
}
