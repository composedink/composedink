import { expect } from "@playwright/test";
import { withStudio } from "./harness.ts";
// Plan 18 Task 6: alternatives flip in place from a widget above the range.
await withStudio(
  "alternatives-inplace",
  async ({ origin, page: open, cli, json, shot, evidence }) => {
    cli("new", "post", "flip");
    const page = await open();
    await page.goto(`${origin}/?doc=flip`);
    const editor = page.locator(".cm-content");
    await expect(editor.locator(".cm-settings-fold")).toBeVisible();
    await page.keyboard.insertText(
      "Intro sentence stays put. The homepage is a Nokia 3310. A closing line follows it.",
    );
    await expect(page.getByRole("status")).toHaveText("Saved");
    const read = json("cat", "flip", "--json");
    cli(
      "alt",
      "propose",
      "flip",
      "--base",
      read.base,
      "--quote",
      "The homepage is a Nokia 3310.",
      "--version",
      "Meet the homepage: a Nokia 3310.",
      "--version",
      "Our homepage behaves like a Nokia 3310.",
    );
    await expect(page.getByTestId("alt-count")).toHaveText("1 alternative in this post");
    await expect(page.locator(".cm-alt-dot")).toHaveCount(1);
    const widget = page.locator(".alt-widget");
    await expect(widget).toHaveCount(0);
    // The aside's Next moves the caret into the range: the widget appears above it.
    await page
      .getByRole("region", { name: "Alternatives" })
      .getByRole("button", { name: "Next" })
      .click();
    await expect(widget).toBeVisible();
    await expect(widget.locator(".alt-count")).toHaveText("1 / 3");
    const box = await widget.boundingBox();
    const line = await editor.locator(".cm-line", { hasText: "Nokia 3310" }).boundingBox();
    expect(box!.y + box!.height).toBeLessThanOrEqual(line!.y + 2);
    await shot(page, "alternative-widget");
    evidence.widgetOnCaret = true;

    // ↓ flips in place.
    await widget.getByRole("button", { name: "Next version" }).click();
    await expect(widget.locator(".alt-count")).toHaveText("2 / 3");
    await expect(editor).toContainText("Meet the homepage: a Nokia 3310.");
    await expect.poll(() => json("cat", "flip", "--json").text).toContain("Meet the homepage");
    evidence.flipInPlace = true;

    // Keyboard: Tab from the editor reaches the widget; ↑ goes back; Escape returns to the text.
    await editor.focus();
    await page.keyboard.press("Tab");
    await expect(widget.getByRole("button", { name: "Previous version" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(widget.locator(".alt-count")).toHaveText("1 / 3");
    await expect(editor).toContainText("The homepage is a Nokia 3310.");
    await page.keyboard.press("Escape");
    await expect(editor).toBeFocused();
    evidence.keyboardReachable = true;

    // Keep: the widget leaves and the other two versions are in the stash.
    await widget.getByRole("button", { name: "Keep", exact: true }).click();
    await expect(widget).toHaveCount(0);
    await expect(page.getByTestId("alt-count")).toHaveCount(0);
    await expect.poll(() => json("stash", "list", "flip").length).toBe(2);
    expect(json("cat", "flip", "--json").alts).toEqual([]);
    evidence.keepStashesTwo = true;

    // Hover shows the widget too; the menu keeps and ghosts the rest.
    const again = json("cat", "flip", "--json");
    cli(
      "alt",
      "propose",
      "flip",
      "--base",
      again.base,
      "--quote",
      "A closing line follows it.",
      "--version",
      "It ends here.",
    );
    await expect(page.getByTestId("alt-count")).toHaveText("1 alternative in this post");
    await editor.locator(".cm-line", { hasText: "Intro" }).click({ position: { x: 5, y: 5 } });
    await expect(widget).toHaveCount(0);
    await editor.getByText("A closing line follows it.").hover();
    await expect(widget).toBeVisible();
    await widget.getByRole("button", { name: "More choices" }).click();
    await shot(page, "alternative-menu");
    await page.getByRole("menuitem", { name: "Keep and ghost the rest" }).click();
    await expect(widget).toHaveCount(0);
    await expect.poll(() => json("cat", "flip", "--json").dim.length).toBe(1);
    expect(json("cat", "flip", "--json").text).toContain("It ends here.");
    evidence.hoverAndGhost = true;
  },
);
