import { chromium, type Browser, type Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { createServer } from "node:net";
/** Plan 18 specs: a temporary home, a headless studio on free ports, and a chromium browser. */
export const root = resolve(import.meta.dirname, "../../..");
const entry = join(root, "apps/cli/src/main.ts");
async function port() {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  const address = s.address();
  if (!address || typeof address === "string") throw Error("No address");
  await new Promise<void>((r) => s.close(() => r()));
  return address.port;
}
export interface Studio {
  home: string;
  origin: string;
  browser: Browser;
  cli: (...args: string[]) => string;
  json: (...args: string[]) => any;
  page: (width?: number) => Promise<Page>;
  shot: (page: Page, name: string) => Promise<void>;
  evidence: Record<string, unknown>;
}
export async function withStudio(name: string, run: (s: Studio) => Promise<void>) {
  const home = await mkdtemp(join(tmpdir(), `composed-${name}-`));
  const env = {
    ...process.env,
    COMPOSED_HOME: home,
    COMPOSED_PORT: String(await port()),
    COMPOSED_ARTIFACT_PORT: String(await port()),
  };
  const cli = (...args: string[]) =>
    execFileSync(process.execPath, ["--experimental-strip-types", entry, ...args], {
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  const child = spawn(
    process.execPath,
    ["--experimental-strip-types", entry, "studio", "--headless"],
    { env, detached: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  let output = "";
  child.stdout.on("data", (b) => (output += String(b)));
  child.stderr.on("data", (b) => (output += String(b)));
  const browser = await chromium.launch({ channel: "chromium" });
  const results = join(root, "test-results");
  await mkdir(results, { recursive: true });
  const evidence: Record<string, unknown> = {};
  const errors: string[] = [];
  try {
    await expect.poll(() => output, { timeout: 30000 }).toContain('"ready":true');
    await run({
      home,
      origin: `http://127.0.0.1:${env.COMPOSED_PORT}`,
      browser,
      cli,
      json: (...args) => JSON.parse(cli(...args)),
      evidence,
      async page(width = 1250) {
        const page = await browser.newPage({ viewport: { width, height: 870 } });
        // Vite's HMR socket closes in middleware mode; every other page error fails the spec.
        page.on("pageerror", (e) => {
          if (!/WebSocket closed without opened/.test(String(e))) errors.push(String(e));
        });
        return page;
      },
      async shot(page, label) {
        await page.screenshot({ path: join(results, `plan-18-${label}.png`), fullPage: true });
      },
    });
    expect(errors).toEqual([]);
    await writeFile(join(results, `plan-18-${name}.json`), JSON.stringify(evidence, null, 2));
    console.log(name, evidence);
  } finally {
    await browser.close();
    if (child.pid) process.kill(-child.pid, "SIGTERM");
    await new Promise<void>((r) => child.once("exit", () => r()));
    await writeFile(join(results, `plan-18-${name}-studio.log`), output);
    await rm(home, { recursive: true, force: true });
  }
}
