import { expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { withStudio } from "./harness.ts";
// Plan 18 Task 5: the writing surface's layout, type and grouped feedback, with the critique's prose.
const prose = await readFile(new URL("./fixtures/critique-prose.mdx", import.meta.url), "utf8");
/** The editor's measure in `ch` of its own font, and its left/right gaps to the writing column. */
const measure = (page: Page) =>
  page.evaluate(() => {
    const content = document.querySelector(".cm-content")!;
    const probe = document.createElement("span");
    probe.textContent = "0".repeat(100);
    probe.style.font = getComputedStyle(content).font;
    probe.style.position = "absolute";
    document.body.append(probe);
    const ch = probe.getBoundingClientRect().width / 100;
    probe.remove();
    return {
      ch: content.getBoundingClientRect().width / ch,
      family: getComputedStyle(content).fontFamily,
      size: getComputedStyle(content).fontSize,
    };
  });
await withStudio("layout", async ({ origin, page: open, cli, json, shot, evidence }) => {
  cli("new", "post", "essay");
  const page = await open(1250);
  await page.goto(`${origin}/?doc=essay`);
  const editor = page.locator(".cm-content");
  await expect(editor.locator(".cm-settings-fold")).toBeVisible();
  await editor.fill(prose);
  await expect.poll(() => json("cat", "essay", "--json").text).toBe(prose);
  await expect(page.getByRole("status")).toHaveText("Saved");
  await page.evaluate(() => document.fonts.ready);

  // Prose face, 19px, a 65–75ch measure; no line numbers.
  const m = await measure(page);
  expect(m.family).toMatch(/^"?Source Serif 4 Variable/);
  expect(m.size).toBe("19px");
  expect(m.ch).toBeGreaterThanOrEqual(65);
  expect(m.ch).toBeLessThanOrEqual(75);
  await expect(page.locator(".cm-lineNumbers")).toHaveCount(0);
  evidence.measure1250 = Math.round(m.ch);

  // No comment column (and no filter) until there is a comment.
  await expect(page.locator(".thread-column")).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Comment filter" })).toHaveCount(0);
  await shot(page, "layout-1250");

  // Grouped feedback: one row per rule with its count; a row opens to its instances.
  const lint = json("lint", "essay") as { code: string; severity: string }[];
  const filler = lint.filter((d) => d.code === "filler").length;
  expect(filler).toBeGreaterThanOrEqual(4);
  const feedback = page.getByRole("region", { name: "Writing feedback" });
  const group = feedback.locator('.rule-group[data-rule="filler"]');
  await expect(group.locator(".rule-name")).toHaveText("Hedges and intensifiers");
  await expect(group.locator(".rule-count")).toHaveText(String(filler));
  await expect(group.locator(".diagnostic")).toHaveCount(filler);
  await expect(group.locator(".diagnostic").first()).toBeHidden();
  await group.locator(".rule-toggle").click();
  await expect(group.locator(".diagnostic").first()).toBeVisible();
  await expect(group.locator(".diagnostic").first().locator("q")).toHaveText("I think");
  await shot(page, "layout-feedback-open");
  // An instance jumps to its text.
  await group.locator(".diagnostic").first().getByRole("button").first().click();
  await expect(page.locator(".source-editor")).toHaveAttribute(
    "data-selection",
    `${prose.indexOf("I think")}-${prose.indexOf("I think") + "I think".length}`,
  );
  // One range, one underline, the stronger severity: **very** is filler and bold.inline.
  const very = page.locator('.cm-lint[data-code~="filler"][data-code~="bold.inline"]');
  await expect(very).toHaveCount(1);
  await expect(very).toHaveText("very");
  // Severity reads from the label and a 1px border, not a side rule.
  const border = await group.evaluate((el) => getComputedStyle(el).borderLeftWidth);
  expect(border).toBe("1px");
  // Dismiss all clears a rule.
  await group.getByRole("button", { name: "Dismiss all: Hedges and intensifiers" }).click();
  await expect(group).toHaveCount(0);
  evidence.groupedFeedback = { filler, groups: await feedback.locator(".rule-group").count() };

  // A stash entry reads in the prose face, with Insert and Remove.
  const { base, text } = json("cat", "essay", "--json") as { base: string; text: string };
  const cut = "It is not clever. ";
  cli(
    "stash",
    "add",
    "essay",
    "--base",
    base,
    "--from",
    String(text.indexOf(cut)),
    "--to",
    String(text.indexOf(cut) + cut.length),
  );
  const item = page.locator(".stash-item");
  await expect(item.locator(".stash-text")).toHaveText(cut.trim());
  expect(
    await item.locator(".stash-text").evaluate((el) => getComputedStyle(el).fontFamily),
  ).toMatch(/Source Serif/);
  await expect(item).toContainText("Cut just now");
  await item.getByRole("button", { name: "Remove" }).click();
  await expect(item).toHaveCount(0);
  expect(json("stash", "list", "essay")).toEqual([]);
  evidence.stashProseRemove = true;

  // The components disclosure is collapsed; the preview address hints at a missing scheme.
  const components = page.locator("details.components");
  await expect(components).not.toHaveAttribute("open", "");
  await components.locator("summary").click();
  const address = components.getByRole("textbox", { name: "Preview address" });
  await expect(address).toHaveAttribute("placeholder", "http://localhost:3000/posts/essay");
  await expect(address).toHaveAttribute("inputmode", "url");
  await address.fill("localhost:3000/posts/essay");
  await expect(components.locator(".field-hint")).toContainText("Start the address with http://");
  await address.fill("http://localhost:3000/posts/essay");
  await expect(components.getByRole("link", { name: "Open the blog preview" })).toBeVisible();
  await components.locator("summary").click();
  evidence.previewHint = true;

  // A comment brings the column (and its filter) in.
  const read = json("cat", "essay", "--json");
  cli(
    "thread",
    "open",
    "essay",
    "--base",
    read.base,
    "--quote",
    "The first draft is always bad.",
    "--text",
    "This is the line.",
  );
  await expect(page.locator(".thread-column")).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Comment filter" })).toBeVisible();
  await shot(page, "layout-1250-comment");
  evidence.commentColumn = true;

  // Zen hides the aids and the settings; the status bar keeps words, save state and Zen.
  await page.getByRole("button", { name: "Zen", exact: true }).click();
  await expect(page.getByRole("complementary", { name: "Writing aids" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Post settings" })).toHaveCount(0);
  await expect(page.locator(".thread-column")).toHaveCount(0);
  const bar = await page
    .locator("footer.statusbar")
    .evaluate((el) => [...el.children].map((c) => (c.textContent ?? "").trim()).filter(Boolean));
  expect(bar).toEqual([expect.stringMatching(/^\d+ \/ 1200 words$/), "Saved", "Zen"]);
  await shot(page, "layout-zen");
  await page.getByRole("button", { name: "Zen", exact: true }).click();
  evidence.zen = bar;

  // Widths: one column below 1000px; the header wraps its action group whole.
  for (const width of [900, 1440]) {
    const sized = await open(width);
    await sized.goto(`${origin}/?doc=essay`);
    await expect(sized.locator(".cm-content")).toContainText("Why I ship");
    await sized.evaluate(() => document.fonts.ready);
    const columns = await sized
      .locator(".workspace")
      .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length);
    expect(columns).toBe(width < 1000 ? 1 : 2);
    for (const name of ["Undo operation", "Share"]) {
      const box = await sized.getByRole("button", { name, exact: true }).boundingBox();
      expect(box!.height).toBeLessThan(40);
    }
    const sizedMeasure = await measure(sized);
    expect(sizedMeasure.ch).toBeLessThanOrEqual(75);
    evidence[`measure${width}`] = Math.round(sizedMeasure.ch);
    await shot(sized, `layout-${width}`);
    await sized.close();
  }
});
