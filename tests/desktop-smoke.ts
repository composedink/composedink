import { desktopRemote } from "./desktop-remote.ts";
import { DatabaseSync } from "node:sqlite";
import { request } from "node:http";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile, readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import WebSocket from "ws";
const exec = promisify(execFile);
const root = resolve(import.meta.dirname, "..");
const evidence = join(root, "test-results/plan-11-smoke-" + Date.now());
await mkdir(evidence, { recursive: true });
const app = join(root, "apps/desktop/src-tauri/target/release/bundle/macos/Composed.app");
const resources = join(app, "Contents/Resources");
const runtime = join(evidence, "runtime");
await mkdir(runtime);
await exec("/usr/bin/tar", ["-xzf", join(resources, "runtime.tar.gz"), "-C", runtime]);
const home = join(evidence, "home");
const cli = join(runtime, "bin/composed");
const env = {
  HOME: process.env.HOME,
  PATH: "/usr/bin:/bin",
  COMPOSED_HOME: home,
  COMPOSED_PORT: "4793",
  COMPOSED_ARTIFACT_PORT: "4893",
};
const origin = "http://127.0.0.1:4793";
const run = async (...args: string[]) =>
  (await exec(cli, args, { env, maxBuffer: 10 * 1024 * 1024 })).stdout;
async function owner(): Promise<{ pid: number; ready: boolean; kind: string }> {
  return JSON.parse(await readFile(join(home, "owner.json"), "utf8"));
}
async function wait(check: () => Promise<boolean>) {
  for (let i = 0; i < 300; i++) {
    if (await check().catch(() => false)) return;
    await delay(50);
  }
  throw Error("Packaged smoke timed out");
}
const proof: Record<string, unknown> = { app, evidence, path: env.PATH };
function bridge() {
  const child = spawn(cli, ["desktop"], { env, stdio: ["pipe", "pipe", "pipe"] });
  child.stdout.on("data", (b) => {
    void writeFile(join(evidence, `bridge-${child.pid}.log`), b, { flag: "a" });
  });
  child.stderr.on("data", (b) => {
    void writeFile(join(evidence, `bridge-${child.pid}.log`), b, { flag: "a" });
  });
  return child;
}
await run("new", "post", "tracer");
const launchStart = performance.now();
let service = bridge();
const readyTime = wait(async () => (await owner()).ready).then(
  () => performance.now() - launchStart,
);
const browser = await chromium.launch({ channel: "chromium" });
try {
  await wait(async () => (await owner()).ready);
  const initial = await owner();
  proof.packagedStudio = true;
  const contender = new DatabaseSync(join(home, "authority.db"));
  try {
    assert.throws(() => contender.exec("BEGIN EXCLUSIVE"), /locked/);
  } finally {
    contender.close();
  }
  proof.sqliteExcludesSecondWriter = true;
  proof.freshHomeSidecarReadyMs = await readyTime;
  assert.equal(initial.kind, "studio");
  const token = await readFile(join(home, "session.token"), "utf8");
  assert.equal(
    (await fetch(origin + "/session", { headers: { Origin: "https://evil.invalid" } })).status,
    403,
  );
  const wrongHost = await new Promise<number | undefined>((resolve, reject) => {
    const req = request(origin + "/session", { headers: { Host: "evil.invalid" } }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.once("error", reject);
    req.end();
  });
  assert.equal(wrongHost, 403);
  async function denied(query: string, requestOrigin: string) {
    const ws = new WebSocket(origin.replace("http:", "ws:") + "/?token=" + query, {
      origin: requestOrigin,
    });
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => {
        ws.close();
        reject(Error("Untrusted socket opened"));
      });
      ws.once("error", () => resolve());
    });
  }
  await denied("wrong", origin);
  await denied(token, "https://evil.invalid");
  proof.hostOriginAndTokenDenied = true;
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") console.error(m.text());
  });
  page.on("pageerror", (e) => errors.push(String(e)));
  const remotes: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("remoteEntry")) remotes.push(r.url());
  });
  await page.goto(origin);
  const editor = page.locator(".cm-content");
  await expect(editor).toBeVisible();
  const sentence = "Desktop packaged persistence " + Date.now() + ".";
  await editor.fill("# Packaged desktop\n\n" + sentence + "\n\nA spare sentence.");
  await expect(page.getByRole("status")).toHaveText("Saved");
  const read = () => run("cat", "tracer", "--json").then((s) => JSON.parse(s));
  assert.match((await read()).text, new RegExp(sentence));
  assert.equal((await owner()).pid, initial.pid);
  proof.editorTypingAndTerminalRead = true;
  let state = await read();
  await run(
    "alt",
    "propose",
    "tracer",
    "--base",
    state.base,
    "--quote",
    sentence,
    "--version",
    "A terminal alternative.",
  );
  await expect(page.locator(".cm-content")).toContainText(sentence);
  state = await read();
  const alt = state.alts[0].id;
  await run("alt", "flip", "tracer", alt);
  await expect(editor).toContainText("A terminal alternative.");
  state = await read();
  const from = state.text.indexOf("A terminal alternative.");
  await run(
    "ghost",
    "set",
    "tracer",
    "--base",
    state.base,
    "--from",
    String(from),
    "--to",
    String(from + 23),
  );
  state = await read();
  assert.ok(state.dim.length);
  await run("alt", "resolve", "tracer", alt);
  assert.ok(JSON.parse(await run("stash", "list", "tracer")).length);
  proof.flipDimAndStash = true;
  const before = await read();
  const updatesBefore = (
    await readdir(join(home, "docs", Buffer.from("tracer").toString("base64url"), "updates"))
  ).filter((n) => n.endsWith(".loro"));
  assert.deepEqual(
    updatesBefore.map((n) => Number(n.replace(".loro", ""))).sort((a, b) => a - b),
    Array.from({ length: updatesBefore.length }, (_, i) => i + 1),
  );
  proof.singleOwnerAndNumberedUpdates = { pid: initial.pid, updates: updatesBefore };
  await page.screenshot({ path: join(evidence, "packaged-studio.png"), fullPage: true });
  await context.close();
  service.stdin.end();
  await wait(async () => !(await owner().catch(() => null)));
  service = bridge();
  await wait(async () => (await owner()).ready);
  assert.notEqual((await owner()).pid, initial.pid);
  const after = await read();
  assert.equal(after.text, before.text);
  assert.deepEqual(after.dim, before.dim);
  assert.deepEqual(
    JSON.parse(await run("stash", "list", "tracer")).map((x: { text: string }) => x.text),
    [sentence],
  );
  proof.persistenceAcrossSidecarRelaunch = true;
  const second = await browser.newPage();
  await second.goto(origin);
  await expect(second.locator(".cm-content")).toContainText("A terminal alternative.");
  assert.equal(
    await second.evaluate(() => localStorage.getItem("composed.selectedDocument")),
    "tracer",
  );
  await run("new", "post", "selected");
  await second.goto(origin + "/?doc=selected");
  await expect(second.getByRole("heading", { level: 1 })).toHaveText("composed · selected");
  await second.goto(origin);
  await expect(second.getByRole("heading", { level: 1 })).toHaveText("composed · selected");
  proof.selectedDocumentDeviceState = true;
  assert.deepEqual(remotes, []);
  assert.deepEqual(errors, []);
  proof.studioLoadsNoRemotes = true;
  await run("lint", "tracer");
  proof.packagedHarperWorker = true;
  await run("component", "create", "desktop/smoke", "--kind", "block");
  const checked = JSON.parse(await run("component", "check", "desktop/smoke"));
  assert.equal(checked.ok, true);
  await second.close();
  proof.packagedComponentToolchain = true;
  proof.remote = await desktopRemote({ root, runtime, evidence, browser, run });
  async function bytes(dir: string): Promise<number> {
    let total = 0;
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      total += e.isDirectory() ? await bytes(p) : (await stat(p)).size;
    }
    return total;
  }
  proof.appBytes = await bytes(app);
  const previewOwner = await owner();
  service.stdin.end();
  await browser.close();
  await delay(2500);
  assert.equal((await owner()).pid, previewOwner.pid);
  proof.previewSubscriptionKeepsOwner = true;
  console.log(JSON.stringify(proof, null, 2));
} finally {
  await browser.close();
  service.stdin.end();
  const remaining = await owner().catch(() => null);
  if (remaining) process.kill(remaining.pid, "SIGTERM");
  await writeFile(join(evidence, "proof.json"), JSON.stringify(proof, null, 2));
}
