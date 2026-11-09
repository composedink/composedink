import { chromium, expect } from "@playwright/test";
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { createServer } from "node:net";
const root = resolve(import.meta.dirname, "../../..");
const home = await mkdtemp(join(tmpdir(), "composed-measurements-"));
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
cli(["new", "post", "measured"]);
const long = "😀 A much longer sentence keeps going with many more words than any of the rest.";
const main =
  "---\ntitle: Measured\nbudget: 30\n---\n\n## Notes\n\n" +
  "It is very good. One two three four. Five six seven eight. Nine ten eleven twelve. Thirteen fourteen fifteen sixteen." +
  "\n\n" +
  long;
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
  // Count lint requests/replies and hold back any request for "Stale" text so its reply
  // arrives after a newer one.
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
        const snapshot =
          message && typeof message === "object" && "snapshot" in message
            ? (message.snapshot as { text?: string })
            : undefined;
        if (snapshot) counters.requests++;
        if (snapshot?.text?.startsWith("Stale")) setTimeout(() => super.postMessage(message), 1500);
        else if (Array.isArray(options)) super.postMessage(message, options);
        else super.postMessage(message, options);
      }
    };
  });
  const counts = () =>
    page.evaluate(
      () => (window as unknown as { __lint: { requests: number; replies: number } }).__lint,
    );
  await page.goto(`http://127.0.0.1:${env.COMPOSED_PORT}/?doc=measured`);
  const editor = page.locator(".cm-content");
  const status = page.getByRole("status");
  const feedback = page.getByRole("region", { name: "Writing feedback" });
  const spark = page.getByTestId("sparkline");
  const bars = spark.locator(".bar");
  const hover = page.getByTestId("sparkline-hover");
  const list = page.getByRole("list", { name: "Sentences by length" });
  await expect(editor.locator(".cm-settings-fold")).toBeVisible();
  await editor.fill(main);
  await expect(status).toHaveText("Saved");

  // Soft budget and rhythm notes and a warn underline, at the same time, with exact ranges.
  const budget = feedback.locator('[data-code="budget"]');
  await expect(budget).toHaveAttribute("data-severity", "soft");
  await expect(budget).toHaveAttribute("data-from", String(main.indexOf("Notes")));
  await expect(budget).toHaveAttribute("data-to", String(main.indexOf("Notes") + 1));
  await expect(budget).toContainText("35 words is 5 over the 30-word budget.");
  // Plan 18: severity is the rule row's label; instances sit under the row.
  await expect(feedback.locator('.rule-group[data-rule="budget"] .severity')).toHaveText("Quiet");
  const rhythm = feedback.locator('[data-code="rhythm"]');
  await expect(rhythm).toHaveAttribute("data-severity", "soft");
  await expect(rhythm).toHaveAttribute("data-from", String(main.indexOf("It is very")));
  await expect(rhythm).toHaveAttribute("data-to", String(main.indexOf("sixteen.") + 8));
  await expect(rhythm).toContainText("5 sentences in a row of 4–4 words");
  const filler = page.locator('.cm-lint[data-code="filler"]');
  await expect(filler).toHaveText("very");
  await expect(filler).toHaveAttribute("data-severity", "warn");
  await expect(filler).toHaveClass(/cm-lint-warn/);
  await expect(filler).toHaveAttribute("data-from", String(main.indexOf("very")));
  await expect(filler).toHaveAttribute("data-to", String(main.indexOf("very") + 4));
  await expect(feedback.locator('.rule-group[data-rule="filler"] .severity')).toHaveText("Note");
  await expect(feedback.locator('.rule-group[data-rule="budget"]')).toBeVisible();
  await expect(feedback.locator('.rule-group[data-rule="rhythm"]')).toBeVisible();
  await expect(page.locator(".cm-lint[data-severity=soft]")).toHaveCount(0);
  await expect(page.locator(".cm-soft-marker")).toHaveCount(2);

  // The sparkline draws the worker's sentences: one bar each, hover and focus show them.
  await expect(bars).toHaveCount(6);
  await expect(spark).toHaveAttribute("data-stale", "false");
  expect(await bars.evaluateAll((b) => b.map((e) => Number(e.dataset.height)))).toEqual([
    4, 4, 4, 4, 4, 15,
  ]);
  await bars.nth(5).hover();
  await expect(hover).toHaveText(`15 words: ${long}`);
  await page.mouse.move(0, 0);
  await expect(hover).toHaveCount(0);
  await spark.focus();
  await expect(hover).toHaveText("4 words: It is very good.");
  await spark.press("ArrowRight");
  await expect(hover).toHaveText("4 words: One two three four.");
  // Keyboard activation opens every sentence, longest first, source order on ties.
  await spark.press("Enter");
  await expect(list.getByRole("button")).toHaveText([
    `15 ${long}`,
    "4 It is very good.",
    "4 One two three four.",
    "4 Five six seven eight.",
    "4 Nine ten eleven twelve.",
    "4 Thirteen fourteen fifteen sixteen.",
  ]);
  await list.getByRole("button").nth(3).click();
  await expect(list).toBeHidden();
  const selected = () => page.evaluate(() => getSelection()?.toString());
  await expect.poll(selected).toBe("Five six seven eight.");
  await spark.click();
  await list.getByRole("button").first().click();
  await expect.poll(selected).toBe(long);

  // An edit invalidates the open list; the next accepted result redraws the bars.
  await spark.click();
  await expect(list).toBeVisible();
  // The long sentence is still selected and ends the document: collapse to its end and type.
  await editor.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.type(" Added.");
  await expect(list).toBeHidden();
  await expect(status).toHaveText("Saved");
  await expect(editor).toContainText("rest. Added.");
  await expect(bars).toHaveCount(7);
  await expect(spark).toHaveAttribute("data-stale", "false");

  // A rules-only change re-lints the same text: diagnostics change, measurements stay.
  const source = JSON.parse(cli(["cat", "measured", "--json"])).text;
  const post = JSON.parse(cli(["kind", "read", "post"]));
  const rules = JSON.parse(post.files["rules.json"]);
  rules.rules.filler = false;
  rules.rules.rhythm = { minSentences: 6 };
  const beforeRules = await counts();
  cli(
    ["kind", "write", "post", "--file", "rules.json", "--base", post.base],
    JSON.stringify(rules),
  );
  await expect(filler).toHaveCount(0);
  await expect(rhythm).toHaveCount(0);
  await expect(budget).toHaveCount(1);
  await expect(bars).toHaveCount(7);
  expect((await counts()).requests).toBeGreaterThan(beforeRules.requests);
  expect(JSON.parse(cli(["cat", "measured", "--json"])).text).toBe(source);

  // A reply for an older text arriving after the newest one is discarded.
  await editor.fill("Stale one here. Stale two here. Stale three here.");
  await expect(status).toHaveText("Saved");
  await page.waitForTimeout(350);
  await editor.fill("Fresh words only.");
  await expect(status).toHaveText("Saved");
  await page.waitForTimeout(2000);
  const settled = await counts();
  expect(settled.replies).toBe(settled.requests);
  await expect(bars).toHaveCount(1);
  await bars.first().hover();
  await expect(hover).toHaveText("3 words: Fresh words only.");

  // Zen hides the sparkline and feedback; leaving it restores them without re-linting.
  await page.getByRole("button", { name: "Zen", exact: true }).click();
  const panelHeading = page.getByRole("heading", { name: "Writing feedback" });
  await expect(spark).toHaveCount(0);
  await expect(panelHeading).toBeHidden();
  await expect(page.getByTestId("word-count")).toBeVisible();
  await editor.press("ControlOrMeta+Shift+Period");
  await expect(bars).toHaveCount(1);
  await expect(panelHeading).toBeVisible();
  expect((await counts()).requests).toBe(settled.requests);

  // 130 sentences: 120 contiguous bars; the list keeps all 130.
  const many = Array.from({ length: 130 }, (_, i) =>
    i === 77 ? "This one is clearly the longest of them all here." : "Short one.",
  ).join(" ");
  await editor.fill(many);
  await expect(status).toHaveText("Saved");
  await expect(bars).toHaveCount(120);
  // floor(71·130/120) = 76 and floor(72·130/120) = 78, so bar 71 holds sentences 76 and 77.
  await expect(bars.nth(71)).toHaveAttribute("data-members", "76 77");
  await expect(bars.nth(70)).toHaveAttribute("data-members", "75");
  // Two soft rhythm runs either side of the long sentence (minSentences is 6 now).
  await expect(feedback.locator('[data-code="rhythm"]')).toHaveCount(2);
  await bars.nth(71).hover();
  await expect(hover).toHaveText("10 words: This one is clearly the longest of them all here.");
  await spark.click();
  await expect(list.getByRole("button")).toHaveCount(130);
  await expect(list.getByRole("button").first()).toHaveText(
    "10 This one is clearly the longest of them all here.",
  );
  await page.screenshot({ path: join(root, "test-results/plan-14-measurements.png") });
  await writeFile(
    join(root, "test-results/plan-14-web.json"),
    JSON.stringify({
      softWithWarnUnderline: true,
      exactRanges: true,
      hoverAndFocus: true,
      listOrdering: true,
      jumpTo: true,
      listInvalidatedOnEdit: true,
      rulesOnlyRefresh: true,
      staleReplyRejected: settled,
      zenRestores: true,
      bucketed: { sentences: 130, bars: 120 },
    }),
  );
  console.log("Severity, sparkline hover/list/jump, rules-only refresh, stale reply and zen PASS");
} finally {
  await browser.close();
  if (child.pid) process.kill(-child.pid, "SIGTERM");
  await new Promise<void>((r) => child.once("exit", () => r()));
  await writeFile(join(root, "test-results/plan-14-measurements-studio.log"), output);
  await rm(home, { recursive: true, force: true });
}
