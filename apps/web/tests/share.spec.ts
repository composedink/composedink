import { chromium, expect } from "@playwright/test";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { createServer } from "node:net";
const root = resolve(import.meta.dirname, "../../..");
const entry = join(root, "apps/cli/src/main.ts");
const BOOTSTRAP = "share-spec-bootstrap";
async function port() {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  const address = s.address();
  if (!address || typeof address === "string") throw Error("No address");
  await new Promise<void>((r) => s.close(() => r()));
  return address.port;
}
async function home(name: string) {
  const path = await mkdtemp(join(tmpdir(), `composed-share-${name}-`));
  const env = {
    ...process.env,
    COMPOSED_HOME: path,
    COMPOSED_PORT: String(await port()),
    COMPOSED_ARTIFACT_PORT: String(await port()),
  };
  const cli = (...args: string[]) =>
    execFileSync(process.execPath, ["--experimental-strip-types", entry, ...args], {
      env,
      encoding: "utf8",
    });
  return { path, env, cli, json: (...args: string[]) => JSON.parse(cli(...args)) };
}
const children: ChildProcess[] = [];
let output = "";
function studio(env: NodeJS.ProcessEnv) {
  const child = spawn(
    process.execPath,
    ["--experimental-strip-types", entry, "studio", "--headless"],
    { env, detached: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  let log = "";
  child.stdout!.on("data", (b) => ((log += String(b)), (output += String(b))));
  child.stderr!.on("data", (b) => (output += String(b)));
  children.push(child);
  return expect.poll(() => log, { timeout: 30000 }).toContain('"ready":true');
}
/** `apps/server` as a process on a random port with temporary storage. */
async function server() {
  const storage = await mkdtemp(join(tmpdir(), "composed-share-server-"));
  const child = spawn(
    process.execPath,
    ["--experimental-strip-types", "--no-warnings", join(root, "apps/server/src/main.ts")],
    {
      env: {
        ...process.env,
        COMPOSED_STORAGE: storage,
        COMPOSED_TOKEN: "artifact",
        COMPOSED_BOOTSTRAP_TOKEN: BOOTSTRAP,
        PORT: "0",
        HOST: "127.0.0.1",
      },
      detached: true,
      stdio: ["ignore", "pipe", "inherit"],
    },
  );
  children.push(child);
  const listening = await new Promise<number>((resolve, reject) => {
    let text = "";
    child.stdout!.on("data", (chunk) => {
      text += chunk;
      const match = /"port":(\d+)/.exec(text);
      if (match) resolve(Number(match[1]));
    });
    child.once("exit", (code) => reject(Error(`server exited ${code}`)));
  });
  return { url: `http://127.0.0.1:${listening}`, storage };
}

const signedOut = await home("out");
const author = await home("author");
const browser = await chromium.launch({ channel: "chromium" });
let storage: string | undefined;
try {
  // A signed-out home: Share is disabled and names the fix.
  signedOut.cli("new", "post", "p");
  await studio(signedOut.env);
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.error("PAGE", e));
  await page.goto(`http://127.0.0.1:${signedOut.env.COMPOSED_PORT}/?doc=p`);
  await expect(page.getByRole("status")).toHaveText("Saved", { timeout: 30000 });
  const share = page.getByRole("button", { name: "Share", exact: true });
  await expect(share).toBeDisabled();
  // Plan 18: the reason is the button's tooltip; the header's Sign in has the command.
  await expect(share).toHaveAttribute("title", /^Sign in to share/);
  await expect(page.getByTestId("share-fix")).toHaveCount(0);
  await page.getByRole("button", { name: "Zen" }).click();
  await expect(share).toBeDisabled();
  await page.getByRole("button", { name: "Zen" }).click();
  await writeFile(
    join(signedOut.path, "session.json"),
    JSON.stringify({ server: "https://example.test" }),
  );
  await page.reload();
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("dialog", { name: "Sign in" })).toContainText(
    "composed login https://example.test",
  );
  await expect(page.getByRole("button", { name: "Share", exact: true })).toBeDisabled();
  await mkdir(join(root, "test-results"), { recursive: true });
  await page.screenshot({ path: join(root, "test-results/plan-17-share-signed-out.png") });
  console.log("Share: disabled with the fix on a signed-out home, hidden fix in zen PASS");

  // A signed-in home: a guest comment arrives by sync with the guest's name and link tag.
  const relay = await server();
  storage = relay.storage;
  author.cli("login", relay.url, "--bootstrap", BOOTSTRAP, "--name", "Author");
  await writeFile(join(author.path, "draft.mdx"), "Alpha beta gamma.\n\nDelta epsilon zeta.\n");
  author.cli("new", "post", "g", "--from", join(author.path, "draft.mdx"), "--i-am-human");
  await studio(author.env);
  const link = author.json("share", "g", "--live");
  const comment = await fetch(`${link.url}/threads`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: relay.url },
    body: JSON.stringify({ quote: "epsilon", text: "Lovely word.", name: "Ada" }),
  });
  if (comment.status !== 201) throw Error(`guest comment ${comment.status}`);
  const guest = await browser.newPage();
  guest.on("pageerror", (e) => console.error("PAGE", e));
  await guest.goto(`http://127.0.0.1:${author.env.COMPOSED_PORT}/?doc=g`);
  await expect(guest.getByRole("status")).toHaveText("Saved", { timeout: 30000 });
  const message = guest.locator(".thread .message", { hasText: "Lovely word." });
  await expect(message).toHaveText(
    `Ada guest · link ${(link.link as string).slice(0, 6)} Lovely word.`,
    { timeout: 30000 },
  );
  // The link's request waits for guests, not for the model.
  await expect(guest.locator(".request[data-status=pending]")).toHaveText(
    `Waiting for guests on link ${(link.link as string).slice(0, 6)}`,
  );
  // Signed in, Share opens the panel with this post's link.
  const open = guest.getByRole("button", { name: "Share", exact: true });
  await expect(open).toBeEnabled();
  await open.click();
  const panel = guest.getByRole("region", { name: "Share" });
  await expect(panel.locator(`[data-link="${link.link}"]`)).toContainText("live");
  await expect(panel.getByRole("textbox", { name: "Link URL" })).toHaveValue(link.url);
  await guest.screenshot({ path: join(root, "test-results/plan-17-share-guest-thread.png") });
  console.log("Share: guest thread labelled by name and link; panel lists the link PASS");
} finally {
  await browser.close();
  for (const child of children)
    if (child.pid && child.exitCode === null)
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {}
  await Promise.all(
    children
      .filter((c) => c.exitCode === null)
      .map((c) => new Promise<void>((r) => c.once("exit", () => r()))),
  );
  await writeFile(join(root, "test-results/plan-17-share-studio.log"), output);
  for (const path of [signedOut.path, author.path, storage])
    if (path) await rm(path, { recursive: true, force: true });
}
