import { chromium, expect } from "@playwright/test";
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { createServer } from "node:net";
const root = resolve(import.meta.dirname, "../../..");
const home = await mkdtemp(join(tmpdir(), "composed-alternatives-"));
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

try {
  await expect.poll(() => output, { timeout: 30000 }).toContain('"ready":true');
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${env.COMPOSED_PORT}/?doc=editor`);
  const editor = page.locator(".cm-content");
  await editor.fill("First sentence. Another sentence.");
  await expect(page.getByRole("status")).toHaveText("Saved");
  const base = JSON.parse(cli("cat", "editor", "--json")).base;
  cli(
    "alt",
    "propose",
    "editor",
    "--base",
    base,
    "--quote",
    "First sentence.",
    "--version",
    "Agent sentence.",
  );
  await expect(page.locator(".alternative")).toContainText("1/2");
  await editor.press("ControlOrMeta+a");
  await editor.press("ArrowLeft");
  await editor.press("Alt+ArrowDown");
  await expect(editor).toContainText("Agent sentence.");
  await expect(page.locator(".alternative")).toContainText("2/2");
  await editor.press("ControlOrMeta+End");
  await page.keyboard.insertText(" Later typing.");
  await expect(page.getByRole("status")).toHaveText("Saved");
  await page.getByRole("button", { name: "Undo operation", exact: true }).click();
  await expect(editor).toContainText("First sentence.");
  await expect(editor).toContainText("Later typing.");
  await page.reload();
  await expect(page.locator(".alternative")).toContainText("1/2");
  await page.locator(".alternative").getByRole("button", { name: "↓", exact: true }).click();
  await expect(editor).toContainText("Agent sentence.");
  await page.locator(".alternative").getByRole("button", { name: "Keep", exact: true }).click();
  await expect(page.locator(".alternative")).toHaveCount(0);
  expect(JSON.parse(cli("stash", "list", "editor"))).toMatchObject([{ text: "First sentence." }]);
  await page.screenshot({ path: join(root, "test-results/plan-04-alternatives.png") });
  await writeFile(
    join(root, "test-results/plan-04-alternatives.json"),
    JSON.stringify({
      keyboard: true,
      flip: true,
      undoPreservesTyping: true,
      reload: true,
      resolveStash: true,
    }),
  );
  console.log("Alternatives UI: keyboard, flip, undo with later typing, reload, keep/stash PASS");
} finally {
  await browser.close();
  if (child.pid) process.kill(-child.pid, "SIGTERM");
  await new Promise<void>((r) => child.once("exit", () => r()));
  await writeFile(join(root, "test-results/plan-04-alternatives-studio.log"), output);
  await rm(home, { recursive: true, force: true });
}
