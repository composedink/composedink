import { chromium, expect } from "@playwright/test";
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, writeFile, rm, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { createServer } from "node:net";
const root = resolve(import.meta.dirname, "../../..");
const home = await mkdtemp(join(tmpdir(), "composed-kinds-zen-"));
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
function cli(args: string[], input?: string) {
  return execFileSync(process.execPath, ["--experimental-strip-types", entry, ...args], {
    env,
    input,
    encoding: "utf8",
  });
}
// A user-defined kind authored through kind.write, extending post with two pattern rules.
const custom = [
  { code: "jargon", message: "Say it plainly.", severity: "warn", phrases: ["synergy"] },
  { code: "aside", message: "Asides slow the reader.", severity: "soft", phrases: ["by the way"] },
];
const rules = (r: Record<string, unknown>) => JSON.stringify({ extends: "post", rules: r, custom });
const postKind = JSON.parse(cli(["kind", "read", "post"])).files["kind.json"];
let base = JSON.parse(cli(["kind", "read", "memo"])).base;
for (const [file, text] of [
  ["kind.json", postKind],
  ["template.mdx", "---\ntitle: Memo\n---\n\nSynergy first, by the way.\n"],
  ["rules.json", rules({})],
])
  base = JSON.parse(cli(["kind", "write", "memo", "--file", file, "--base", base], text)).base;
cli(["new", "post", "memo-doc", "--kind", "memo"]);
// A kind that exists at creation and is then absent on this device.
await mkdir(join(home, "kinds", "gone"), { recursive: true });
for (const file of ["kind.json", "template.mdx", "rules.json"])
  await writeFile(
    join(home, "kinds", "gone", file),
    await readFile(join(home, "kinds", "memo", file), "utf8"),
  );
cli(["new", "post", "gone-doc", "--kind", "gone"]);
await rm(join(home, "kinds", "gone"), { recursive: true });
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
  page.on("pageerror", (e) => console.error("PAGE", e));
  await page.addInitScript(() => {
    const counters = { requests: 0, replies: 0 };
    Object.assign(window, { __lint: counters });
    const NativeWorker = Worker;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener("message", () => counters.replies++);
      }
      postMessage(message: unknown, options?: StructuredSerializeOptions | Transferable[]) {
        if (message && typeof message === "object" && "snapshot" in message) counters.requests++;
        if (Array.isArray(options)) super.postMessage(message, options);
        else super.postMessage(message, options);
      }
    };
  });
  const counts = () =>
    page.evaluate(
      () => (window as unknown as { __lint: { requests: number; replies: number } }).__lint,
    );
  await page.goto(`http://127.0.0.1:${env.COMPOSED_PORT}/?doc=memo-doc`);
  const editor = page.locator(".cm-content");
  const feedback = page.getByRole("region", { name: "Writing feedback" });
  const status = page.getByRole("status");
  // Template and frontmatter defaults applied once at creation.
  // The settings block is folded; the strip shows its values (plan 18).
  const strip = page.getByRole("region", { name: "Post settings" });
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Memo");
  await expect(strip.getByRole("textbox", { name: "Reader" })).toHaveValue("blog readers");
  await expect(editor).toContainText("Synergy first, by the way.");
  await expect(page.getByTestId("kind")).toHaveText("Kind: Memo");
  await expect(page.getByTestId("kind-warning")).toHaveCount(0);
  // The kind's rules run: a warn rule underlines; a soft rule only marks the gutter.
  await expect(page.locator('.cm-lint[data-code="jargon"]')).toHaveText("Synergy");
  await expect(feedback.locator('[data-code="aside"]')).toHaveAttribute("data-severity", "soft");
  await expect(page.locator('.cm-lint[data-code="aside"]')).toHaveCount(0);
  await expect(page.locator(".cm-lint[data-severity=soft]")).toHaveCount(0);
  await expect(page.locator(".cm-soft-marker")).toHaveCount(1);
  // The status bar counts rhythm notes only (plan 18); a custom soft rule lists in the panel.
  await expect(page.getByTestId("soft-count")).toHaveCount(0);
  expect(JSON.parse(cli(["lint", "memo-doc"])).map((d: { code: string }) => d.code)).toContain(
    "jargon",
  );
  // Disabling the code in rules.json silences both the editor and `composed lint`.
  const current = JSON.parse(cli(["kind", "read", "memo"])).base;
  cli(
    ["kind", "write", "memo", "--file", "rules.json", "--base", current],
    rules({ jargon: false }),
  );
  await expect(page.locator('.cm-lint[data-code="jargon"]')).toHaveCount(0);
  await expect(feedback.locator('[data-code="jargon"]')).toHaveCount(0);
  await expect(feedback.locator('[data-code="aside"]')).toHaveCount(1);
  expect(JSON.parse(cli(["lint", "memo-doc"])).map((d: { code: string }) => d.code)).not.toContain(
    "jargon",
  );
  // Zen: decorations, gutter notes and the feedback/alternatives/stash panels hide; word count
  // and save state stay.
  await page.getByRole("button", { name: "Zen", exact: true }).click();
  await expect(page.getByRole("button", { name: "Zen", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(feedback).toBeHidden();
  await expect(page.getByRole("heading", { name: "Alternatives" })).toBeHidden();
  await expect(page.getByRole("button", { name: "Stash selection" })).toBeHidden();
  await expect(page.locator(".cm-soft-marker")).toHaveCount(0);
  await expect(page.getByTestId("soft-count")).toHaveCount(0);
  await expect(page.getByTestId("word-count")).toBeVisible();
  await expect(status).toBeVisible();
  // Lint keeps running while hidden; leaving zen shows the newest result without re-linting.
  const before = await counts();
  await editor.fill("It was written quickly.");
  await expect(status).toHaveText("Saved");
  await expect(page.getByTestId("word-count")).toHaveText(/^4 \/ \d+ words$/);
  await expect.poll(async () => (await counts()).replies).toBeGreaterThan(before.replies);
  await page.waitForTimeout(1000);
  await expect(page.locator(".cm-lint")).toHaveCount(0);
  const settled = await counts();
  expect(settled.requests).toBeGreaterThan(before.requests);
  expect(settled.replies).toBe(settled.requests);
  const source = JSON.parse(cli(["cat", "memo-doc", "--json"])).text;
  await editor.press("ControlOrMeta+Shift+Period");
  await expect(page.getByRole("button", { name: "Zen", exact: true })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await expect(page.locator('.cm-lint[data-code="style:adverb"]')).toHaveText("quickly");
  await expect(feedback.locator('[data-code="style:adverb"]')).toHaveCount(1);
  expect((await counts()).requests).toBe(settled.requests);
  expect(JSON.parse(cli(["cat", "memo-doc", "--json"])).text).toBe(source);
  // The preference is per device and survives reload.
  await editor.press("ControlOrMeta+Shift+Period");
  expect(await page.evaluate(() => localStorage.getItem("composed.zen"))).toBe("true");
  await page.reload();
  await expect(page.getByRole("button", { name: "Zen", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(feedback).toBeHidden();
  await expect(page.getByTestId("word-count")).toHaveText(/^4 \/ \d+ words$/);
  await page.getByRole("button", { name: "Zen", exact: true }).click();
  await expect(page.locator('.cm-lint[data-code="style:adverb"]')).toHaveText("quickly");
  expect(await page.evaluate(() => localStorage.getItem("composed.zen"))).toBe("false");
  // A kind missing on this device: post rules with a visible warning, recorded id retained.
  await page.goto(`http://127.0.0.1:${env.COMPOSED_PORT}/?doc=gone-doc`);
  await expect(page.getByTestId("kind-warning")).toContainText('Kind "gone" is not configured');
  await expect(page.getByTestId("kind")).toHaveText("Kind: Gone");
  await expect(editor).toContainText("Synergy first");
  await expect.poll(async () => (await counts()).replies).toBeGreaterThan(0);
  await expect(page.locator('.cm-lint[data-code="jargon"]')).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Writing feedback" }).locator('[data-code="jargon"]'),
  ).toHaveCount(0);
  await page.screenshot({ path: join(root, "test-results/plan-13-kinds-zen.png") });
  await writeFile(
    join(root, "test-results/plan-13-web.json"),
    JSON.stringify({
      template: true,
      defaults: true,
      customRule: true,
      softWithoutUnderline: true,
      disableSilencesEditorAndCli: true,
      zenHidesAndRestores: true,
      zenKey: true,
      zenReload: true,
      lintDuringZen: { before, settled },
      missingKindWarning: true,
    }),
  );
  console.log("Kinds, effective rules, soft notes, zen toggle/key/reload and missing kind PASS");
} finally {
  await browser.close();
  if (child.pid) process.kill(-child.pid, "SIGTERM");
  await new Promise<void>((r) => child.once("exit", () => r()));
  await writeFile(join(root, "test-results/plan-13-kinds-zen-studio.log"), output);
  await rm(home, { recursive: true, force: true });
}
