import { chromium, expect } from "@playwright/test";
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { createServer } from "node:net";
const root = resolve(import.meta.dirname, "../../..");
const home = await mkdtemp(join(tmpdir(), "composed-session-status-"));
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
execFileSync(process.execPath, ["--experimental-strip-types", entry, "new", "post", "p"], { env });
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
  await page.goto(`http://127.0.0.1:${env.COMPOSED_PORT}/?doc=p`);
  await expect(page.getByRole("status")).toHaveText("Saved", { timeout: 30000 });
  const session = page.getByTestId("session");
  // A home that never signed in: the fix has no server to name.
  await expect(session).toHaveText("Signed out composed login <server>");
  // Zen hides the column and panels but keeps the session, like the save state.
  await page.getByRole("button", { name: "Zen" }).click();
  await expect(page.getByRole("button", { name: "Zen" })).toHaveAttribute("aria-pressed", "true");
  await expect(session).toBeVisible();
  await page.getByRole("button", { name: "Zen" }).click();
  // After logout or revocation session.json keeps the server, and the fix names it.
  await writeFile(join(home, "session.json"), JSON.stringify({ server: "https://example.test" }));
  await page.reload();
  await expect(page.getByTestId("session")).toHaveText(
    "Signed out composed login https://example.test",
  );
  await mkdir(join(root, "test-results"), { recursive: true });
  await page.screenshot({ path: join(root, "test-results/plan-16-session-status.png") });
  console.log(
    "Session status: signed out with the fix, visible in zen, names the stored server PASS",
  );
} finally {
  await browser.close();
  if (child.pid) process.kill(-child.pid, "SIGTERM");
  await new Promise<void>((r) => child.once("exit", () => r()));
  await writeFile(join(root, "test-results/plan-16-session-status-studio.log"), output);
  await rm(home, { recursive: true, force: true });
}
