import { chromium, expect } from "@playwright/test";
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { createServer } from "node:net";
import { createServer as httpServer } from "node:http";
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
let release = () => {};
let gate = new Promise<void>((r) => {
  release = r;
});
let fail = false;
let calls = 0;
let completed = () => {};
const provider = httpServer(async (req, res) => {
  for await (const chunk of req) void chunk;
  calls++;
  await gate;
  if (fail) res.statusCode = 500;
  res.setHeader("Content-Type", "application/json");
  res.end(
    JSON.stringify({
      choices: [{ message: { content: JSON.stringify(["Version A", "Version B", "Version C"]) } }],
    }),
  );
  completed();
});
await new Promise<void>((r) => provider.listen(0, "127.0.0.1", r));
const address = provider.address();
if (!address || typeof address === "string") throw Error("No port");
await writeFile(
  join(home, "config.json"),
  JSON.stringify({
    rewrite: { endpoint: `http://127.0.0.1:${address.port}/v1/chat/completions`, model: "double" },
  }),
);
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
  await editor.fill("Original sentence.\n\nOther paragraph.");
  await expect(page.getByRole("status")).toHaveText("Saved");
  await editor.press("ControlOrMeta+a");
  await editor.press("ArrowLeft");
  for (let i = 0; i < "Original sentence.".length; i++) await editor.press("Shift+ArrowRight");
  await editor.press("ControlOrMeta+Shift+r");
  await expect(page.getByRole("button", { name: "Cancel rewrite", exact: true })).toBeVisible();
  await expect.poll(() => calls).toBe(1);
  await editor.press("ControlOrMeta+a");
  await editor.press("ArrowRight");
  await expect(page.locator(".source-editor")).toHaveAttribute("data-selection", "36-36");
  await page.keyboard.insertText(" Human edit.");
  await expect(page.getByRole("status")).toHaveText("Saved");
  await expect
    .poll(() => JSON.parse(cli("cat", "editor", "--json")).text)
    .toBe("Original sentence.\n\nOther paragraph. Human edit.");
  release();
  // Plan 18: the aside counts alternatives; the widget above the range shows its versions.
  await expect(page.getByTestId("alt-count")).toHaveText("1 alternative in this post");
  await page
    .getByRole("region", { name: "Alternatives" })
    .getByRole("button", { name: "Next" })
    .click();
  await expect(page.locator(".alt-widget .alt-count")).toHaveText("1 / 4");
  expect(JSON.parse(cli("cat", "editor", "--json")).text).toBe(
    "Original sentence.\n\nOther paragraph. Human edit.",
  );
  await editor.press("ControlOrMeta+a");
  await editor.press("ArrowLeft");
  await editor.press("Alt+ArrowDown");
  await expect(editor).toContainText("Version A");
  await editor.press("ControlOrMeta+Enter");
  await expect(page.getByTestId("alt-count")).toHaveCount(0);
  expect(JSON.parse(cli("stash", "list", "editor"))).toHaveLength(3);
  gate = new Promise<void>((r) => {
    release = r;
  });
  await editor.fill("Cancel sentence.");
  await expect(page.getByRole("status")).toHaveText("Saved");
  await editor.press("ControlOrMeta+a");
  await editor.press("ControlOrMeta+Shift+r");
  await expect.poll(() => calls).toBe(2);
  await page.getByRole("button", { name: "Cancel rewrite", exact: true }).click();
  await expect(page.getByRole("button", { name: "Cancel rewrite", exact: true })).toHaveCount(0);
  const late = new Promise<void>((r) => {
    completed = r;
  });
  release();
  await late;
  await expect.poll(() => JSON.parse(cli("cat", "editor", "--json")).alts.length).toBe(0);
  await editor.focus();
  await editor.press("ArrowRight");
  await page.keyboard.insertText(" Human typing.");
  await expect(page.getByRole("status")).toHaveText("Saved");
  expect(JSON.parse(cli("cat", "editor", "--json")).text).toBe("Cancel sentence. Human typing.");
  gate = Promise.resolve();
  fail = true;
  await editor.press("ControlOrMeta+a");
  await editor.press("ControlOrMeta+Shift+r");
  await expect(page.getByRole("alert")).toHaveAttribute("data-code", "ProviderFailed");
  expect(JSON.parse(cli("cat", "editor", "--json")).alts).toHaveLength(0);
  fail = false;
  await editor.press("ControlOrMeta+Shift+r");
  await expect(page.getByTestId("alt-count")).toHaveText("1 alternative in this post");
  await page.reload();
  await expect(page.getByTestId("alt-count")).toHaveText("1 alternative in this post");
  await page
    .getByRole("region", { name: "Alternatives" })
    .getByRole("button", { name: "Next" })
    .click();
  await expect(page.locator(".alt-widget .alt-count")).toHaveText("1 / 4");
  await page.screenshot({ path: join(root, "test-results/plan-07-alternatives.png") });
  await writeFile(
    join(root, "test-results/plan-07-alternatives.json"),
    JSON.stringify({
      keyboard: true,
      flip: true,
      pendingTyping: true,
      cancellationAndLateOutput: true,
      failureAndRetry: true,
      reload: true,
      resolveStash: true,
    }),
  );
  console.log("Rewrites UI: keyboard, original active, flip, keep, cancel and later typing PASS");
} finally {
  await browser.close();
  provider.closeAllConnections();
  await new Promise<void>((r) => provider.close(() => r()));
  if (child.pid) process.kill(-child.pid, "SIGTERM");
  await new Promise<void>((r) => child.once("exit", () => r()));
  await writeFile(join(root, "test-results/plan-07-alternatives-studio.log"), output);
  await rm(home, { recursive: true, force: true });
}
