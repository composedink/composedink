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
cli("deps", "add", "editor", "Chart", "composed:test/block@dev");

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
  await page.addInitScript(() => {
    const NativeWorker = Worker;
    window.Worker = class extends NativeWorker {
      postMessage(message: unknown, options?: StructuredSerializeOptions | Transferable[]) {
        if (
          message &&
          typeof message === "object" &&
          "snapshot" in message &&
          message.snapshot &&
          typeof message.snapshot === "object" &&
          "text" in message.snapshot &&
          message.snapshot.text === "Stale quickly."
        ) {
          setTimeout(() => super.postMessage(message), 1500);
        } else if (Array.isArray(options)) super.postMessage(message, options);
        else super.postMessage(message, options);
      }
    };
  });
  await page.goto(`http://127.0.0.1:${env.COMPOSED_PORT}/?doc=editor`);
  const editor = page.locator(".cm-content");
  await editor.fill("😀 This is an test. It was written quickly to utilize tools.");
  const feedback = page.getByRole("region", { name: "Writing feedback" });
  await expect(feedback.locator('[data-code="style:adverb"]')).toHaveAttribute("data-from", "35");
  await expect(page.locator('.cm-lint[data-code="style:simpler"]')).toHaveText("utilize");
  const before = JSON.parse(cli("cat", "editor", "--json")).text;
  // Plan 18: feedback groups by rule; a rule's row opens to its instances.
  await feedback.locator('.rule-group[data-rule="style:simpler"] .rule-toggle').click();
  await feedback.getByRole("button", { name: "Propose “use”", exact: true }).click();
  await expect(page.getByTestId("alt-count")).toHaveText("1 alternative in this post");
  expect(JSON.parse(cli("cat", "editor", "--json")).text).toBe(before);
  await page
    .getByRole("region", { name: "Alternatives" })
    .getByRole("button", { name: "Next" })
    .click();
  await page.locator(".alt-widget").getByRole("button", { name: "Next version" }).click();
  await expect(editor).toContainText("to use tools.");
  await expect(feedback.locator('[data-code="style:adverb"]')).toHaveCount(1);
  await feedback.locator('.rule-group[data-rule="style:adverb"] .rule-toggle').click();
  await feedback
    .locator('[data-code="style:adverb"]')
    .getByRole("button", { name: "Dismiss", exact: true })
    .click();
  await expect(feedback.locator('[data-code="style:adverb"]')).toHaveCount(0);
  await page.reload();
  await expect(feedback.locator('[data-code="style:adverb"]')).toHaveCount(1);
  await editor.fill("Stale quickly.");
  await expect(page.getByRole("status")).toHaveText("Saved");
  await page.waitForTimeout(350);
  await editor.fill("The garden grows.");
  await expect(page.getByRole("status")).toHaveText("Saved");
  await page.waitForTimeout(2000);
  await expect(feedback.locator(".diagnostic")).toHaveCount(0);
  await expect(page.locator(".cm-lint")).toHaveCount(0);
  await editor.fill("The garden grows quickly.");
  await expect(feedback.locator('[data-code="style:adverb"]')).toHaveCount(1);
  await editor.fill("<Chart name={42} />");
  await expect(feedback.locator('[data-code="block:props"]')).toHaveAttribute("data-from", "0");
  await expect(feedback.locator('[data-code="block:props"]')).toHaveAttribute("data-to", "19");
  await editor.fill("The garden grows quickly.");
  await expect(feedback.locator('[data-code="style:adverb"]')).toHaveCount(1);
  await page.screenshot({ path: join(root, "test-results/plan-06-lint.png") });
  await writeFile(
    join(root, "test-results/plan-06-web.json"),
    JSON.stringify({
      underlines: true,
      positions: true,
      proposalPreservesText: true,
      flip: true,
      dismissalLocal: true,
      delayedStaleReplyIgnored: true,
      newestWorkerResult: true,
    }),
  );
  console.log(
    "Positioned underlines, proposals, flip, local dismissal and delayed stale worker reply PASS",
  );
} finally {
  await browser.close();
  if (child.pid) process.kill(-child.pid, "SIGTERM");
  await new Promise<void>((r) => child.once("exit", () => r()));
  await writeFile(join(root, "test-results/plan-06-lint-studio.log"), output);
  await rm(home, { recursive: true, force: true });
}
