import { expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { withStudio } from "./harness.ts";
// Plan 18 Task 4: one error at a time, in writer copy, beside the control that failed.
await withStudio("errors", async ({ home, origin, page: open, cli, shot, evidence }) => {
  cli("new", "post", "plain");
  const page = await open();
  await page.goto(`${origin}/?doc=plain`);
  const editor = page.locator(".cm-content");
  const status = page.getByRole("status");
  await expect(editor.locator(".cm-settings-fold")).toBeVisible();
  await page.keyboard.insertText("A short body sentence for the model to read.");
  await expect(status).toHaveText("Saved");

  // Status bar: words against the budget, save state, kind, shortcuts, zen; no cursor line.
  const bar = page.locator("footer.statusbar");
  await expect(page.getByTestId("word-count")).toHaveText("9 / 1200 words");
  await expect(page.getByTestId("kind")).toHaveText("Kind: Post");
  await expect(page.getByText(/^Cursor \d+/)).toHaveCount(0);
  await expect(page.getByText(/UTF-16 units/)).toHaveCount(0);
  const items = await bar.evaluate((el) =>
    [...el.children].map((c) => (c.textContent ?? "").trim()).filter(Boolean),
  );
  expect(items.slice(0, 3)).toEqual(["9 / 1200 words", "Saved", "Kind: Post"]);
  expect(items.slice(-2)).toEqual(["Shortcuts", "Zen"]);
  await page.getByRole("button", { name: "Shortcuts" }).click();
  const keys = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(keys).toContainText("Ask the writing model for rewrites of the selection");
  await expect(keys).toContainText("Undo operation");
  await shot(page, "shortcuts");
  await page.keyboard.press("Escape");
  await expect(keys).toHaveCount(0);
  evidence.statusBar = items;

  // Signed out: once, in the header; the status bar has no session item.
  await expect(page.getByText("Not signed in")).toHaveCount(1);
  await expect(bar.getByTestId("session")).toHaveCount(0);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("dialog", { name: "Sign in" })).toContainText(
    "composed devices pair",
  );
  await page.keyboard.press("Escape");
  const share = page.getByRole("button", { name: "Share", exact: true });
  await expect(share).toBeDisabled();
  await expect(share).toHaveAttribute("title", /Sign in to share/);
  await expect(page.getByTestId("share-fix")).toHaveCount(0);
  evidence.signedOutOnce = true;

  // Ask with no writing model: one notice under the Ask form, save state untouched.
  await page.getByRole("button", { name: "Ask the model" }).click();
  const form = page.getByRole("form", { name: "Feedback questions" });
  await expect(form).toBeVisible();
  await form.getByRole("button", { name: "Ask", exact: true }).click();
  const panel = page.getByRole("region", { name: "Model feedback" });
  const notice = panel.getByRole("alert");
  await expect(notice).toHaveCount(1);
  await expect(notice).toHaveAttribute("data-code", "ProviderFailed");
  await expect(notice.locator(".notice-title")).toHaveText(
    "No writing model is set up on this device yet.",
  );
  await expect(page.getByRole("alert")).toHaveCount(1);
  await expect(page.getByText(/Error:|ProviderFailed:/)).toHaveCount(0);
  await notice.getByText("How to set one up").click();
  await expect(notice).toContainText("~/.composed/config.json");
  await expect(notice).toContainText("endpoint");
  await expect(status).toHaveText("Saved");
  await expect(form).toBeVisible();
  await shot(page, "ask-no-model");
  await page.reload();
  await expect(editor.locator(".cm-settings-fold")).toBeVisible();
  await expect(page.locator(".request")).toHaveCount(0);
  evidence.askNoModel = true;

  // A rewrite with no model: the notice sits where the rewrite runs; the save state stays Saved.
  await editor.click();
  await editor.press("ControlOrMeta+a");
  await editor.press("ControlOrMeta+Shift+r");
  await expect(page.getByRole("alert")).toHaveCount(1);
  await expect(page.getByRole("alert")).toHaveAttribute("data-code", "ProviderFailed");
  await expect(status).toHaveText("Saved");
  await page.getByRole("alert").getByRole("button", { name: "Dismiss" }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  evidence.rewriteNoModel = true;

  // An operation with no control: one header notice, in words.
  await page.getByRole("button", { name: "Undo operation" }).click();
  await expect(page.getByRole("alert")).toHaveCount(1);
  await expect(page.getByRole("alert")).toHaveAttribute("data-code", "NothingToUndo");
  await expect(page.getByRole("alert").locator(".notice-title")).toHaveText(
    "There is nothing to undo.",
  );
  evidence.headerNotice = true;

  // Over budget turns the figure to the warning colour.
  await page
    .getByRole("region", { name: "Post settings" })
    .getByRole("spinbutton", { name: "Budget" })
    .fill("5");
  await expect(page.getByTestId("word-count")).toHaveText("9 / 5 words");
  await expect(page.getByTestId("word-count")).toHaveClass(/over/);
  evidence.overBudget = true;

  // A home that once signed in knows its server: the disclosure names the login command.
  await writeFile(join(home, "session.json"), JSON.stringify({ server: "https://example.test" }));
  await page.reload();
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("dialog", { name: "Sign in" })).toContainText(
    "composed login https://example.test",
  );
  await shot(page, "sign-in");
  evidence.signInCommand = true;
});
