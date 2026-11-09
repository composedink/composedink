import { expect } from "@playwright/test";
import { withStudio } from "./harness.ts";
// Plan 18 Task 3: the settings strip, the folded block and the malformed-block notice.
await withStudio("settings", async ({ origin, page: open, cli, json, shot, evidence }) => {
  cli("new", "post", "strip");
  const page = await open();
  await page.goto(`${origin}/?doc=strip`);
  const editor = page.locator(".cm-content");
  const status = page.getByRole("status");
  await expect(editor.locator(".cm-settings-fold")).toHaveText("settings");
  await expect(editor).not.toContainText("title:");
  // The caret starts in the body; typing lands there, never in the folded block.
  await page.keyboard.insertText(
    "One two three four. Five six seven eight. Nine ten eleven twelve thirteen.",
  );
  await expect(status).toHaveText("Saved");
  const text = () => json("cat", "strip", "--json").text as string;
  expect(text()).toMatch(/^---\n[\s\S]*\n---\n\nOne two three four\./);
  // Backspace at the body's start cannot eat the block.
  await editor.press("ControlOrMeta+Home");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Home");
  for (let i = 0; i < 3; i++) await page.keyboard.press("Backspace");
  await page.keyboard.insertText("X");
  await expect(status).toHaveText("Saved");
  expect(text()).toMatch(/^---\ntitle: Untitled\n[\s\S]*budget: 1200\n---\n/);
  evidence.foldedBlockProtected = true;
  await editor.press("ControlOrMeta+z");
  await expect(status).toHaveText("Saved");

  const strip = page.getByRole("region", { name: "Post settings" });
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Untitled");
  await expect(strip.getByRole("combobox", { name: "Medium" })).toHaveValue("web");
  const budget = strip.getByRole("spinbutton", { name: "Budget" });
  await expect(budget).toHaveValue("1200");
  await budget.fill("1500");
  await expect.poll(text).toContain("\nbudget: 1500\n");
  await budget.press("ControlOrMeta+z");
  await expect(status).toHaveText("Saved");
  await expect.poll(text).toContain("\nbudget: 1200\n");
  await expect(budget).toHaveValue("1200");
  evidence.budgetEditUndo = true;
  await page.getByRole("textbox", { name: "Title" }).fill("Settings: a strip");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Settings: a strip");
  await expect.poll(text).toContain('\ntitle: "Settings: a strip"\n');
  await strip.getByRole("combobox", { name: "Medium" }).selectOption("phone");
  await expect.poll(text).toContain("\nmedium: phone\n");
  await shot(page, "settings-strip");
  evidence.titleAndMedium = true;

  // Unfold, break the YAML by typing: one notice, counts and rhythm still read the body.
  const words = page.getByTestId("word-count");
  await expect(words).toHaveText("13 / 1200 words");
  await expect(page.getByTestId("sparkline").locator(".bar")).toHaveCount(3);
  await editor.locator(".cm-settings-fold").click();
  await expect(editor).toContainText("budget: 1200");
  await page.keyboard.insertText("\nbroken: [unclosed");
  await expect(status).toHaveText("Saved");
  const feedback = page.getByRole("region", { name: "Writing feedback" });
  const notice = feedback.getByRole("alert");
  await expect(notice).toHaveCount(1);
  await expect(notice).toContainText("The post's settings block is malformed (line 6):");
  await expect(words).toHaveText("13 / 1200 words");
  await expect(page.getByTestId("sparkline").locator(".bar")).toHaveCount(3);
  await expect(page.getByText("YAMLParseError")).toHaveCount(0);
  await expect(strip.getByRole("spinbutton", { name: "Budget" })).toBeDisabled();
  await shot(page, "settings-malformed");
  evidence.malformedOneNotice = true;
  // Leaving the broken block keeps it open; the notice's Unfold returns to it.
  await editor.locator(".cm-line").last().click();
  await expect(editor).toContainText("broken: [unclosed");
  await notice.getByRole("button", { name: "Unfold" }).click();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(notice).toHaveCount(0);
  await expect(status).toHaveText("Saved");
  expect(text()).not.toContain("broken");
  // A block that parses folds again once the caret leaves it.
  await editor.locator(".cm-line").last().click();
  await expect(editor.locator(".cm-settings-fold")).toBeVisible();
  evidence.fixedNoticeGone = true;

  // Replacing everything (select all, then type) still replaces the block.
  await editor.fill("---\ntitle: Filled\n---\n\nFilled body.");
  await expect.poll(text).toBe("---\ntitle: Filled\n---\n\nFilled body.");
  evidence.replaceAll = true;

  // A kind that keeps reading fields in meta shows them read-only, with the reason.
  cli("new", "post", "timber", "--kind", "hellotimber");
  await page.goto(`${origin}/?doc=timber`);
  const reader = page
    .getByRole("region", { name: "Post settings" })
    .getByRole("textbox", { name: "Reader" });
  await expect(reader).toHaveValue("blog readers");
  await expect(reader).toHaveAttribute("readonly", "");
  await expect(reader).toHaveAttribute("title", /keeps reader out of the exported file/);
  evidence.metaFieldsReadOnly = true;
});
