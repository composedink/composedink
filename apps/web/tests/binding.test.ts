import { chromium } from "@playwright/test";
import { createServer } from "vite";
import { expect, it } from "vite-plus/test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

it("keeps CodeMirror equal to mdx after both mixed-container imports (R2)", async () => {
  const server = await createServer({
    configFile: false,
    root: resolve(import.meta.dirname, ".."),
    server: { host: "127.0.0.1", port: 0 },
    optimizeDeps: { exclude: ["loro-crdt", "loro-codemirror"] },
    plugins: [
      {
        name: "spike-page",
        configureServer(server) {
          server.middlewares.use((req, res, next) => {
            if (req.url !== "/") return next();
            res.setHeader("Content-Type", "text/html");
            res.end("<!doctype html><html><head></head><body></body></html>");
          });
        },
      },
    ],
  });
  await server.listen();
  const browser = await chromium.launch({ channel: "chromium" });
  try {
    const page = await browser.newPage();
    await page.goto(server.resolvedUrls!.local[0]);
    const results = await page.evaluate<
      Array<{ kind: string; batches: string[][]; editor: string; loro: string }>
    >(`(async () => {
      const fixture = await import("/tests/binding-fixture.ts");
      return [await fixture.runSpike("map"), await fixture.runSpike("text")];
    })()`);
    const editing = await page.evaluate(`(async () => {
      const fixture = await import("/tests/binding-fixture.ts");
      return fixture.runEditing();
    })()`);
    expect(editing).toMatchObject({
      selected: "**bold**",
      beforeUndo: "😀 **bold** 日本語 remote",
      afterUndo: " remote",
      loro: " remote",
    });
    const artifacts = resolve(import.meta.dirname, "../../../test-results");
    await mkdir(artifacts, { recursive: true });
    await writeFile(resolve(artifacts, "r2.json"), JSON.stringify(results, null, 2));
    for (const result of results) expect(result.editor, JSON.stringify(result)).toBe(result.loro);
  } finally {
    await browser.close();
    await server.close();
  }
}, 30_000);
