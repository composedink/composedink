import { expect, type Page } from "@playwright/test";
export async function assertInteractiveRemote(page: Page) {
  await expect(page.locator('[data-state="remote"]')).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole("button")).toContainText("clicked 0");
  await page.getByRole("button").click();
  await expect(page.getByRole("button")).toContainText("clicked 1");
  await page.getByRole("button").click();
  await expect(page.getByRole("button")).toContainText("clicked 2");
  expect(
    await page.evaluate(() => {
      const host: unknown = Reflect.get(window, "__composedReactIdentity");
      const remote: unknown = Reflect.get(window, "__composedRemoteReactIdentity");
      if (!host || typeof host !== "object" || !remote || typeof remote !== "object") return false;
      return (
        "useState" in host &&
        "useState" in remote &&
        "createElement" in host &&
        "createElement" in remote &&
        typeof host.useState === "function" &&
        typeof host.createElement === "function" &&
        host.useState === remote.useState &&
        host.createElement === remote.createElement
      );
    }),
  ).toBe(true);
}
