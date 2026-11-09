import { chromium, expect, type Page } from "@playwright/test";
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { createServer } from "node:net";
import { createServer as httpServer } from "node:http";
const root = resolve(import.meta.dirname, "../../..");
const home = await mkdtemp(join(tmpdir(), "composed-threads-"));
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
const cli = (...args: string[]) =>
  JSON.parse(
    execFileSync(process.execPath, ["--experimental-strip-types", entry, ...args], {
      env,
      encoding: "utf8",
    }),
  );
// Review double: holds each answer until released; notes and a rewrite on the second paragraph.
let release = () => {};
let gate = Promise.resolve();
let calls = 0;
let completed = () => {};
const provider = httpServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  calls++;
  const brief = JSON.parse(JSON.parse(body).messages[1].content);
  await gate;
  res.setHeader("Content-Type", "application/json");
  res.end(
    JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify({
              answers: brief.questions.map((q: { id: string }, i: number) => ({
                question: q.id,
                text: `Answer ${i + 1}`,
                notes: i === 0 ? [{ quote: "Delta", text: "Name it." }] : [],
                rewrites:
                  i === 0 ? [{ quote: "Delta epsilon zeta.", versions: ["Delta, briefly."] }] : [],
              })),
            }),
          },
        },
      ],
    }),
  );
  completed();
});
const hold = () => {
  gate = new Promise<void>((r) => {
    release = r;
  });
};
await new Promise<void>((r) => provider.listen(0, "127.0.0.1", r));
const address = provider.address();
if (!address || typeof address === "string") throw Error("No port");
await writeFile(
  join(home, "config.json"),
  JSON.stringify({
    rewrite: { endpoint: `http://127.0.0.1:${address.port}/v1/chat/completions`, model: "double" },
  }),
);
const paragraphs = Array.from(
  { length: 40 },
  (_, i) => `Paragraph ${i + 1} is about topic ${i + 1}.`,
);
const source = ["Alpha beta gamma.", "Delta epsilon zeta.", ...paragraphs].join("\n\n");
await writeFile(join(home, "draft.mdx"), source);
execFileSync(
  process.execPath,
  [
    "--experimental-strip-types",
    entry,
    "new",
    "post",
    "talk",
    "--from",
    join(home, "draft.mdx"),
    "--i-am-human",
  ],
  { env },
);
const child = spawn(
  process.execPath,
  ["--experimental-strip-types", entry, "studio", "--headless"],
  {
    env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let output = "";
child.stdout.on("data", (b) => (output += String(b)));
child.stderr.on("data", (b) => (output += String(b)));
const browser = await chromium.launch({ channel: "chromium" });

/** Selects a phrase through the DOM selection, which CodeMirror adopts. */
async function select(page: Page, needle: string) {
  await page.locator(".cm-line", { hasText: needle }).first().scrollIntoViewIfNeeded();
  await page.evaluate((needle) => {
    const content = document.querySelector<HTMLElement>(".cm-content")!;
    content.focus();
    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const i = node.textContent!.indexOf(needle);
      if (i < 0) continue;
      const range = document.createRange();
      range.setStart(node, i);
      range.setEnd(node, i + needle.length);
      getSelection()!.removeAllRanges();
      getSelection()!.addRange(range);
      return;
    }
    throw Error(`not rendered: ${needle}`);
  }, needle);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const [from, to] = document
          .querySelector(".source-editor")!
          .getAttribute("data-selection")!
          .split("-")
          .map(Number);
        return to - from;
      }),
    )
    .toBe(needle.length);
}
/** Card top minus the highlight's top: zero when the comment is aligned with its anchor. */
async function offset(page: Page, thread: string) {
  const card = await page
    .locator(`.thread-anchored .thread[data-thread="${thread}"]`)
    .boundingBox();
  const mark = await page.locator(`.cm-thread[data-thread="${thread}"]`).first().boundingBox();
  if (!card || !mark) return Infinity;
  return Math.round(card.y - mark.y);
}
const threads = () =>
  cli("thread", "list", "talk") as {
    thread: string;
    state: string;
    messages: { by: unknown; text: string }[];
  }[];
const evidence: Record<string, unknown> = {};

try {
  await expect.poll(() => output, { timeout: 30000 }).toContain('"ready":true');
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.on("pageerror", (e) => console.error("PAGE", e));
  await page.goto(`http://127.0.0.1:${env.COMPOSED_PORT}/?doc=talk`);
  const editor = page.locator(".cm-content");
  const status = page.getByRole("status");
  const column = page.getByRole("complementary", { name: "Comments" });
  await expect(editor).toContainText("Alpha beta gamma.");

  // Offline comment from a selection, aligned with its highlight.
  await select(page, "beta");
  await page.getByRole("button", { name: "Comment", exact: true }).click();
  await page.getByRole("textbox", { name: "Comment text" }).fill("Why beta?");
  await page.getByRole("button", { name: "Post comment" }).click();
  await expect(column.locator(".thread")).toHaveCount(1);
  const beta = (await column.locator(".thread").getAttribute("data-thread"))!;
  await expect(page.locator(`.cm-thread[data-thread="${beta}"]`)).toHaveText("beta");
  await expect.poll(() => offset(page, beta)).toBeLessThanOrEqual(4);
  expect(await offset(page, beta)).toBeGreaterThanOrEqual(-4);
  // Reply through the op; attribution is the studio's human.
  await column
    .locator(`[data-thread="${beta}"]`)
    .getByRole("textbox", { name: "Reply" })
    .fill("Because.");
  await page.keyboard.press("Enter");
  await expect(column.locator(`[data-thread="${beta}"]`)).toContainText("Because.");
  expect(threads()[0].messages.map((m) => [m.by, m.text])).toEqual([
    [{ kind: "human" }, "Why beta?"],
    [{ kind: "human" }, "Because."],
  ]);
  // A second thread on the same line stacks below the first instead of overlapping it.
  const base = cli("cat", "talk", "--json").base;
  const gamma = cli(
    "thread",
    "open",
    "talk",
    "--base",
    base,
    "--quote",
    "gamma",
    "--text",
    "And gamma?",
  ).thread;
  await expect(column.locator(`[data-thread="${gamma}"]`)).toBeVisible();
  await expect
    .poll(async () => {
      const a = await column.locator(`[data-thread="${beta}"]`).boundingBox();
      const b = await column.locator(`[data-thread="${gamma}"]`).boundingBox();
      return a && b ? b.y - (a.y + a.height) : -1;
    })
    .toBeGreaterThanOrEqual(0);
  evidence.stacking = true;

  // A comment far down the document stays aligned after scrolling and re-wrapping.
  const far = cli(
    "thread",
    "open",
    "talk",
    "--base",
    base,
    "--quote",
    "Paragraph 38 is",
    "--text",
    "Far down.",
  ).thread;
  // The card is placed from CodeMirror's height map even before its line is rendered.
  await column.locator(`[data-thread="${far}"]`).scrollIntoViewIfNeeded();
  await expect.poll(() => offset(page, far)).toBe(0);
  await page.mouse.wheel(0, -400);
  await expect.poll(() => offset(page, far)).toBe(0);
  await page.setViewportSize({ width: 820, height: 900 });
  // Re-wrapping moves the line; bring it back into CodeMirror's rendered viewport first.
  await column.locator(`[data-thread="${far}"]`).scrollIntoViewIfNeeded();
  await expect.poll(() => offset(page, far)).toBe(0);
  await page.setViewportSize({ width: 1400, height: 900 });
  evidence.scrollAndResizeAlignment = true;

  // Typing above an anchor moves its comment with it.
  await page.evaluate(() => scrollTo(0, 0));
  const before = (await column.locator(`[data-thread="${beta}"]`).boundingBox())!.y;
  await editor.press("ControlOrMeta+a");
  await editor.press("ArrowLeft");
  await page.keyboard.insertText("Intro.\n\nMore intro.\n\n");
  await expect(status).toHaveText("Saved");
  await expect
    .poll(async () => (await column.locator(`[data-thread="${beta}"]`).boundingBox())!.y - before)
    .toBeGreaterThan(40);
  await expect.poll(() => offset(page, beta)).toBeLessThanOrEqual(4);
  evidence.editMovement = true;

  // Resolve is a state change behind the list filter.
  await column.locator(`[data-thread="${beta}"]`).getByRole("button", { name: "Resolve" }).click();
  await expect(column.locator(`.thread-anchored [data-thread="${beta}"]`)).toHaveCount(0);
  await expect(page.locator(`.cm-thread[data-thread="${beta}"]`)).toHaveCount(0);
  await page.getByRole("combobox", { name: "Comment filter" }).selectOption("resolved");
  await expect(column.locator(`.thread-anchored [data-thread="${beta}"]`)).toHaveAttribute(
    "data-state",
    "resolved",
  );
  await page.getByRole("combobox", { name: "Comment filter" }).selectOption("open");

  // Deleting all of gamma detaches its thread to the bottom group, with no highlight, for good.
  await select(page, "gamma");
  await page.keyboard.press("Backspace");
  await expect(status).toHaveText("Saved");
  const detached = page.getByRole("region", { name: "Detached comments" });
  await expect(detached.locator(`[data-thread="${gamma}"]`)).toContainText("And gamma?");
  await expect(page.locator(`.cm-thread[data-thread="${gamma}"]`)).toHaveCount(0);
  await expect.poll(() => threads().find((t) => t.thread === gamma)?.state).toBe("detached");
  await page.keyboard.insertText("gamma");
  await expect(status).toHaveText("Saved");
  expect(threads().find((t) => t.thread === gamma)?.state).toBe("detached");
  evidence.detachment = true;

  // Reload: everything comes back from the document.
  await page.reload();
  await expect(editor).toContainText("Alpha beta gamma.");
  await expect(detached.locator(`[data-thread="${gamma}"]`)).toBeVisible();
  await expect(column.locator(`.thread-anchored [data-thread="${far}"]`)).toBeVisible();
  await column.locator(`[data-thread="${far}"]`).scrollIntoViewIfNeeded();
  await expect.poll(() => offset(page, far)).toBe(0);
  evidence.reload = true;
  await page.evaluate(() => scrollTo(0, 0));

  // Directed questions: the kind's four, editable; answers land as threads and alternatives.
  hold();
  await page.getByRole("button", { name: "Ask the model" }).click();
  await expect(page.getByRole("textbox", { name: /^Question \d$/ })).toHaveCount(4);
  await expect(page.getByRole("textbox", { name: "Question 1" })).toHaveValue(
    "How easy was it to read, and what one thing would improve it?",
  );
  await page.getByRole("textbox", { name: "Question 1" }).fill("Is the opening clear?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(page.getByText("Waiting for the model…")).toBeVisible();
  await expect.poll(() => calls).toBe(1);
  // Typing continues while the model works.
  await editor.press("ControlOrMeta+a");
  await editor.press("ArrowRight");
  await page.keyboard.insertText(" The end.");
  await expect(status).toHaveText("Saved");
  const typed = cli("cat", "talk", "--json").text;
  expect(typed.endsWith("topic 40. The end.")).toBe(true);
  release();
  const answers = page.locator(".request[data-status=answered] .answer");
  await expect(answers).toHaveCount(4);
  await expect(answers.first().locator("h4")).toHaveText("Is the opening clear?");
  await expect(answers.first()).toContainText("Answer 1");
  expect(cli("cat", "talk", "--json").text).toBe(typed);
  await answers.first().getByRole("button", { name: "Note: Name it." }).click();
  const note = column.locator(".thread.active");
  await expect(note).toContainText("Q: Is the opening clear?");
  await expect(note).toContainText("Model Name it.");
  await expect(
    page.locator(`.cm-thread[data-thread="${await note.getAttribute("data-thread")}"]`),
  ).toHaveText("Delta");
  await answers.first().getByRole("button", { name: "Show suggested rewrite (1)" }).click();
  await expect(page.locator(".alternative")).toContainText("1/2");
  expect(cli("cat", "talk", "--json").text).toBe(typed);
  // Acceptance is explicit through the existing alternative controls.
  await editor.press("Alt+ArrowDown");
  await expect(editor).toContainText("Delta, briefly.");
  await editor.press("ControlOrMeta+Enter");
  await expect(page.locator(".alternative")).toHaveCount(0);
  await expect
    .poll(() => cli("cat", "talk", "--json").text)
    .toBe(typed.replace("Delta epsilon zeta.", "Delta, briefly."));
  evidence.modelAnswers = true;

  // Cancellation before the answer commits: the request is removed (plan 18), the Ask form says
  // so, and late output is ignored.
  hold();
  await page.getByRole("button", { name: "Ask the model" }).click();
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect.poll(() => calls).toBe(2);
  const late = new Promise<void>((r) => {
    completed = r;
  });
  await page.getByRole("button", { name: "Cancel request" }).click();
  await expect(
    page.getByRole("region", { name: "Model feedback" }).getByRole("alert"),
  ).toContainText("The request was cancelled.");
  await expect(page.locator(".request[data-status=failed]")).toHaveCount(0);
  const count = threads().length;
  release();
  await late;
  await page.waitForTimeout(300);
  expect(threads()).toHaveLength(count);
  expect(cli("cat", "talk", "--json").alts).toHaveLength(0);
  evidence.cancel = true;

  // Zen hides the column and highlights; threads keep syncing underneath.
  await page.getByRole("button", { name: "Zen", exact: true }).click();
  await expect(column).toHaveCount(0);
  await expect(page.locator(".cm-thread")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Ask the model" })).toBeHidden();
  const quiet = cli(
    "thread",
    "open",
    "talk",
    "--base",
    cli("cat", "talk", "--json").base,
    "--quote",
    "Paragraph 2 is",
    "--text",
    "While zen.",
  ).thread;
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "Zen", exact: true }).click();
  await expect(column.locator(`[data-thread="${quiet}"]`)).toContainText("While zen.");
  await expect(page.locator(`.cm-thread[data-thread="${quiet}"]`)).toHaveCount(1);
  evidence.zen = true;

  await page.screenshot({ path: join(root, "test-results/plan-15-threads.png"), fullPage: true });
  await writeFile(
    join(root, "test-results/plan-15-threads.json"),
    JSON.stringify(evidence, null, 2),
  );
  console.log(
    "Threads: offline open/reply/resolve, stacking, scroll/resize alignment, edit movement, detachment, reload, model answers, cancel and zen PASS",
  );
} finally {
  await browser.close();
  provider.closeAllConnections();
  await new Promise<void>((r) => provider.close(() => r()));
  if (child.pid) process.kill(-child.pid, "SIGTERM");
  await new Promise<void>((r) => child.once("exit", () => r()));
  await writeFile(join(root, "test-results/plan-15-threads-studio.log"), output);
  await rm(home, { recursive: true, force: true });
}
