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

  const title = page.getByRole("textbox", { name: "Title" });
  await expect(title).toHaveValue("Untitled");
  await title.fill("Settings: a strip");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Settings: a strip");
  await expect.poll(text).toContain('\ntitle: "Settings: a strip"\n');
  await title.press("ControlOrMeta+z");
  await expect(status).toHaveText("Saved");
  await expect.poll(text).toContain("\ntitle: Untitled\n");
  await expect(title).toHaveValue("Untitled");
  evidence.titleEditUndo = true;
  await title.fill("Settings: a strip");
  await expect.poll(text).toContain('\ntitle: "Settings: a strip"\n');
  await shot(page, "settings-strip");
  evidence.titleEdited = true;

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
  await expect(title).toBeDisabled();
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
});
