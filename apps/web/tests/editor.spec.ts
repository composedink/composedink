import { chromium, expect } from "@playwright/test";
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { createServer } from "node:net";
const root = resolve(import.meta.dirname, "../../..");
const home = await mkdtemp(join(tmpdir(), "composed-editor-"));
async function port() {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  const address = s.address();
  if (!address || typeof address === "string") throw Error("No address");
  await new Promise<void>((r) => s.close(() => r()));
  return address.port;
}
const env = {
  ...process.env,
  COMPOSED_HOME: home,
  COMPOSED_PORT: String(await port()),
  COMPOSED_ARTIFACT_PORT: String(await port()),
};
const entry = join(root, "apps/cli/src/main.ts");
function cli(...args: string[]) {
  return execFileSync(process.execPath, ["--experimental-strip-types", entry, ...args], {
    env,
    encoding: "utf8",
  });
}
cli("new", "post", "editor");
cli("component", "create", "test/block", "--kind", "block");
const child = spawn(
  process.execPath,
  ["--experimental-strip-types", entry, "studio", "--headless"],
  { env, detached: true, stdio: ["ignore", "pipe", "pipe"] },
);
let output = "";
child.stdout.on("data", (b) => (output += String(b)));
child.stderr.on("data", (b) => (output += String(b)));
const browser = await chromium.launch({ channel: "chromium" });
const results: Record<string, unknown> = {};
try {
  await expect.poll(() => output, { timeout: 30000 }).toContain('"ready":true');
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on("pageerror", (e) => console.error("PAGE", e));
  await page.goto(`http://127.0.0.1:${env.COMPOSED_PORT}/?doc=editor`);
  results.ordering = await page.evaluate(`(async () => {
    const session = await fetch('/session').then(r => r.json());
    const ws = new WebSocket(session.origin.replace('http:', 'ws:') + '/?token=' + session.token);
    await new Promise(r => ws.onopen = r);
    const replies = [];
    const done = new Promise((resolve, reject) => {
      ws.onmessage = e => {
        const frame = JSON.parse(e.data);
        if (!frame.request) return;
        if (frame.error) { reject(Error(frame.error)); return; }
        replies.push(frame.request);
        if (replies.length === 3) resolve(replies);
      };
    });
    ws.send(JSON.stringify({request: 1, name:'doc.create', input:{slug:'ordered'}}));
    ws.send(JSON.stringify({request: 2, name:'doc.read', input:{doc:'ordered'}}));
    ws.send(JSON.stringify({request: 3, name:'doc.read', input:{doc:'ordered'}}));
    const repliesInOrder = await done;
    ws.close();
    return repliesInOrder;
  })()`);
  expect(results.ordering).toEqual([1, 2, 3]);
  const editor = page.locator(".cm-content");
  await expect(editor).toBeVisible();
  await editor.fill("# Hello 😀\n\nA **bold** sentence.");
  await expect(page.getByRole("status")).toHaveText("Saved");
  expect(JSON.parse(cli("cat", "editor", "--json")).text).toBe(
    "# Hello 😀\n\nA **bold** sentence.",
  );
  await page.reload();
  await expect(editor).toContainText("bold");
  results.persistReload = true;
  await editor.press("ControlOrMeta+End");
  const cdp = await context.newCDPSession(page);
  await cdp.send("Input.imeSetComposition", { text: "日本語", selectionStart: 3, selectionEnd: 3 });
  await cdp.send("Input.insertText", { text: "日本語" });
  await expect(editor).toContainText("日本語");
  await expect(page.getByRole("status")).toHaveText("Saved");
  results.ime = true;

  cli("deps", "add", "editor", "Card", "composed:test/block@dev");
  await editor.press("ControlOrMeta+End");
  await page.keyboard.insertText(" Local 😀");
  await expect(page.getByRole("status")).toHaveText("Saved");
  await editor.press("ControlOrMeta+z");
  await expect(editor).not.toContainText("Local");
  await expect(page.getByRole("status")).toHaveText("Saved");
  results.keystrokeUndo = true;
  await page.getByText("Workspace actions", { exact: true }).click();
  await page.getByRole("combobox").selectOption("deps.add");
  await page.getByLabel("Input (JSON)").fill(
    JSON.stringify({
      doc: "editor",
      tag: "Human",
      component: "composed:test/block",
      version: "dev",
    }),
  );
  await page.getByRole("button", { name: "Run action" }).click();
  await expect(page.getByTestId("deps")).toContainText("Human");
  await context.setOffline(true);
  await page.waitForTimeout(300);
  await editor.press("ControlOrMeta+End");
  await page.keyboard.insertText(" offline 🐈");
  await expect(page.getByRole("status")).toContainText("Unsaved");
  await context.setOffline(false);
  await expect(page.getByRole("status")).toHaveText("Saved", { timeout: 15000 });
  expect(JSON.parse(cli("cat", "editor", "--json")).text).toContain("offline 🐈");
  results.reconnectDurableAck = true;
  await expect(page.getByTestId("deps")).toContainText("Card");
  await page.getByRole("button", { name: "Undo operation" }).click();
  await expect(page.getByTestId("deps")).not.toContainText("Human");
  await expect(page.getByTestId("deps")).toContainText("Card");
  expect(JSON.parse(cli("cat", "editor", "--json")).text).toContain("offline 🐈");
  results.operationUndoIsolation = true;
  results.operationUndoAfterReconnect = true;
  await page.getByRole("button", { name: "Undo operation" }).click();
  await expect(page.getByRole("alert")).toContainText("NothingToUndo");
  results.remoteOpsExcluded = true;
  await editor.press("ControlOrMeta+End");
  await page.keyboard.insertText('\n\n<Card name="Lachlan" />');
  await expect(page.locator(".chip")).toContainText("Valid props");
  await expect(page.locator(".chip")).toContainText("@dev");
  expect(
    await page.evaluate(() =>
      performance
        .getEntriesByType("resource")
        .map((e) => e.name)
        .filter((n) => n.includes("remoteEntry")),
    ),
  ).toEqual([]);
  results.chipsDoNotExecuteRemotes = true;
  await editor.press("ControlOrMeta+End");
  await page.keyboard.insertText("\n\n<Card name={123} />");
  await expect(page.locator(".chip").last()).not.toContainText("Valid props");
  results.schemaValidation = true;

  await page.screenshot({ path: join(root, "test-results/plan-03-editor.png") });
  await writeFile(join(root, "test-results/plan-03-editor.json"), JSON.stringify(results, null, 2));
  console.log(results);
} finally {
  await browser.close();
  if (child.pid) process.kill(-child.pid, "SIGTERM");
  await new Promise<void>((r) => child.once("exit", () => r()));
  await mkdir(join(root, "test-results"), { recursive: true });
  await writeFile(join(root, "test-results/plan-03-studio.log"), output);
  await rm(home, { recursive: true, force: true });
}
