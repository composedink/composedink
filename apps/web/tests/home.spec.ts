import { expect } from "@playwright/test";
import { withStudio } from "./harness.ts";
// Plan 18 Task 2: Home, New post and the end of the "tracer" fallback.
await withStudio("home", async ({ origin, page: open, cli, json, shot, evidence }) => {
  const page = await open();
  await page.goto(origin);
  await expect(page.getByRole("heading", { level: 1, name: "Posts" })).toBeVisible();
  await expect(page.getByRole("region", { name: "No posts yet" })).toContainText(
    "Start your first post",
  );
  await expect(page.locator(".cm-content")).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await shot(page, "home-empty");
  evidence.coldOpenEmptyHome = true;

  // New post of a kind: title focused, slug derived, kinds arrow-navigable, Enter submits.
  await page.getByRole("button", { name: "New post" }).click();
  const dialog = page.getByRole("dialog", { name: "New post" });
  await expect(dialog.getByRole("textbox", { name: "Title" })).toBeFocused();
  await expect(dialog.getByRole("radio", { name: /^Post/ })).toBeChecked();
  await expect(dialog.locator('[data-kind="weekly-update"]')).toContainText(
    "Done · Next · Blocked",
  );
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  evidence.escapeCancels = true;
  await page.getByRole("button", { name: "New post" }).click();
  await dialog.getByRole("textbox", { name: "Title" }).fill("Week 45: Shipped the list");
  await expect(dialog.getByRole("textbox", { name: "Slug" })).toHaveValue(
    "week-45-shipped-the-list",
  );
  await dialog.getByRole("radio", { name: /^Post/ }).focus();
  for (let i = 0; i < 6; i++) {
    if (await dialog.getByRole("radio", { name: /^Weekly update/ }).isChecked()) break;
    await page.keyboard.press("ArrowDown");
  }
  await expect(dialog.getByRole("radio", { name: /^Weekly update/ })).toBeChecked();
  await shot(page, "new-post");
  await dialog.getByRole("textbox", { name: "Title" }).press("Enter");
  await page.waitForURL(/\?doc=week-45-shipped-the-list$/);
  const editor = page.locator(".cm-content");
  await expect(editor).toContainText("## Done");
  await expect(page.getByTestId("kind")).toContainText(/weekly.update/i);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Week 45: Shipped the list");
  await expect(page.getByRole("heading", { level: 1 })).toHaveAttribute(
    "title",
    "week-45-shipped-the-list",
  );
  const created = json("cat", "week-45-shipped-the-list", "--json");
  expect(created.text).toMatch(/^---\ntitle: "Week 45: Shipped the list"\n[\s\S]*## Done/);
  // The caret starts in the body, after the settings block.
  const caret = await page.evaluate(() => getSelection()?.anchorNode?.textContent ?? "");
  expect(caret).not.toMatch(/^title:/);
  await shot(page, "new-post-opened");
  evidence.newPostOfKind = true;

  // Unknown slug: Home with one notice.
  await page.goto(`${origin}/?doc=no-such-post`);
  await expect(page.getByRole("alert")).toHaveCount(1);
  await expect(page.getByRole("alert")).toContainText("There is no post called “no-such-post”.");
  await expect(page.getByRole("heading", { level: 1, name: "Posts" })).toBeVisible();
  await shot(page, "home-unknown");
  evidence.unknownSlugNotice = true;

  // Two posts, newest first; a row opens its post.
  await new Promise((r) => setTimeout(r, 30));
  cli("new", "post", "second-thoughts");
  await page.goto(origin);
  const rows = page.getByRole("list", { name: "Posts" }).getByRole("listitem");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("Untitled");
  await expect(rows.nth(0)).toContainText("Post");
  await expect(rows.nth(1)).toContainText("Week 45: Shipped the list");
  await expect(rows.nth(1)).toContainText("Weekly update");
  await expect(rows.nth(1)).toContainText(/\d+ words/);
  await expect(rows.nth(1)).toContainText("edited just now");
  await shot(page, "home-list");
  await rows.nth(1).getByRole("link").click();
  await page.waitForURL(/\?doc=week-45-shipped-the-list$/);
  await page.getByRole("link", { name: "All posts" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Posts" })).toBeVisible();
  evidence.listNewestFirst = true;
  for (const width of [900, 1440]) {
    const sized = await open(width);
    await sized.goto(origin);
    await expect(sized.getByRole("list", { name: "Posts" })).toBeVisible();
    await shot(sized, `home-list-${width}`);
    await sized.close();
  }
});
