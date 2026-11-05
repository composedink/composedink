import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, cp, symlink, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:net";
import { chromium, expect } from "@playwright/test";
const root = resolve(import.meta.dirname, "..");
console.log("runtime", process.version, process.execPath);
const evidence = join(root, "test-results");
await mkdir(evidence, { recursive: true });
const home = await mkdtemp(join(tmpdir(), "composed-tracer-"));
const example = join(home, "example");
const children = new Set<ChildProcess>();
const env = { ...process.env, COMPOSED_HOME: home, VP_NODE_VERSION: "22.22.3" };
async function port() {
  const server = createServer();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address();
  if (!address || typeof address === "string") throw Error("No port");
  await new Promise<void>((r) => server.close(() => r()));
  return address.port;
}
const [studioPort, artifactPort, hostPort] = await Promise.all([port(), port(), port()]);
Object.assign(env, {
  COMPOSED_PORT: String(studioPort),
  COMPOSED_ARTIFACT_PORT: String(artifactPort),
});
function launch(command: string, args: string[], cwd = root) {
  const child = spawn(command, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
  children.add(child);
  let output = "";
  child.stdout!.on("data", (b) => {
    output += String(b);
    if (args.includes("dev")) console.error(String(b));
  });
  child.stderr!.on("data", (b) => {
    output += String(b);
    if (args.includes("dev")) console.error(String(b));
  });
  child.on("exit", () => children.delete(child));
  const done = new Promise<string>((r, j) => {
    child.on("error", j);
    child.on("exit", (code) => (code === 0 ? r(output) : j(Error(output))));
  });
  void done.catch(() => {});
  return { child, output: () => output, done };
}
async function cli(args: string[], input = "") {
  const run = launch(process.execPath, [
    "--experimental-strip-types",
    join(root, "apps/cli/src/main.ts"),
    ...args,
  ]);
  run.child.stdin!.end(input);
  return run.done;
}
async function stop(child: ChildProcess) {
  const done = new Promise<void>((r) => child.once("exit", () => r()));
  child.kill("SIGTERM");
  await done;
}
const checks: Record<string, unknown> = {};
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  await cp(join(root, "examples/host-tanstack"), example, {
    recursive: true,
    filter: (p) => !p.includes("/node_modules") && !p.includes("/dist") && !p.includes("/.vite"),
  });
  const config = JSON.parse(await readFile(join(example, "tsconfig.json"), "utf8"));
  config.extends = join(root, "tsconfig.json");
  await writeFile(join(example, "tsconfig.json"), JSON.stringify(config));
  await symlink(
    join(root, "examples/host-tanstack/node_modules"),
    join(example, "node_modules"),
    "dir",
  );
  async function studio() {
    const run = launch(process.execPath, [
      "--experimental-strip-types",
      join(root, "apps/cli/src/main.ts"),
      "studio",
    ]);
    await expect.poll(() => run.output(), { timeout: 30000 }).toContain('"ready":true');
    return run;
  }
  let owner = await studio();
  await cli(["new", "post", "tracer"]);
  await cli(["component", "create", "lachieh/hello", "--kind", "inline"]);
  await cli(["deps", "add", "tracer", "Hello", "composed:lachieh/hello@dev"]);
  const instrumented = JSON.parse(await cli(["component", "read", "lachieh/hello"]));
  await cli(
    ["component", "write", "lachieh/hello", "--base", instrumented.base, "--file", "block.tsx"],
    instrumented.files["block.tsx"].replace(
      " const [n,",
      ' if (typeof window !== "undefined") Object.assign(window, {__composedRemoteReactIdentity:React});\n const [n,',
    ) +
      "\nexport const __composedReactIdentity = React;\n// COMPOSED_HELLO_IMPLEMENTATION_SENTINEL\n",
  );
  const routerPath = join(example, "src/router.tsx");
  await writeFile(
    routerPath,
    (await readFile(routerPath, "utf8")) +
      '\nimport * as React from "react";\nif (typeof window !== "undefined") Object.assign(window,{__composedReactIdentity:React});\n',
  );
  browser = await chromium.launch({
    args: ["--disable-background-timer-throttling", "--disable-renderer-backgrounding"],
  });
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.error("PAGE", e));
  page.on("console", (m) => console.error("STUDIO", m.type(), m.text()));
  page.on("requestfailed", (r) => console.error("REQUEST", r.url(), r.failure()));
  await page.goto(`http://127.0.0.1:${studioPort}/?doc=tracer`);
  const source = '---\ntitle: Tracer\n---\n\nA <Hello name="Lachlan" />\n';
  await page
    .locator(".cm-content")
    .fill(source, { timeout: 20000 })
    .catch(async (e) => {
      console.error(owner.output());
      console.error(await page.content());
      throw e;
    });
  await expect(page.getByRole("status")).toHaveText("Saved");
  expect(await cli(["cat", "tracer"])).toBe(source);
  await page.close();
  await stop(owner.child);
  owner = await studio();
  expect(await cli(["cat", "tracer"])).toBe(source);
  checks["1"] = true;
  await cli(["preview", "tracer", "--to", join(example, "content")]);
  const lock = JSON.parse(
    await readFile(join(example, "content/tracer/composed.lock.json"), "utf8"),
  );
  expect(await readFile(join(example, "content/tracer/index.mdx"), "utf8")).toBe(source);
  expect(lock.blocks.Hello.version).toMatch(/^0.1.0-dev\./);
  expect(Object.values(lock.blocks.Hello.instances)).toEqual([
    { props: { name: "Lachlan" }, markdown: "Hello, **Lachlan**." },
  ]);
  checks["2"] = true;
  const build = launch(
    join(root, "examples/host-tanstack/node_modules/.bin/rsbuild"),
    ["build"],
    example,
  );
  await build.done.finally(() => writeFile(join(evidence, "tracer-build.log"), build.output()));
  const host = launch(
    join(root, "examples/host-tanstack/node_modules/.bin/rsbuild"),
    ["dev", "--host", "127.0.0.1", "--port", String(hostPort)],
    example,
  );
  const url = `http://127.0.0.1:${hostPort}/posts/tracer`;
  await expect
    .poll(
      async () => {
        try {
          return (await fetch(url, { signal: AbortSignal.timeout(5000) })).status;
        } catch {
          return 0;
        }
      },
      { timeout: 30000 },
    )
    .toBe(200);
  const nojs = await browser.newContext({ javaScriptEnabled: false });
  const staticPage = await nojs.newPage();
  await staticPage.goto(url);
  await expect(staticPage.locator('[data-state="fallback"]')).toHaveText("Hello, Lachlan.");
  const capture = async (page: import("@playwright/test").Page, name: string) => {
    await page
      .screenshot({ path: join(evidence, name), timeout: 2000, animations: "disabled" })
      .catch((e) => console.error(String(e)));
  };
  await capture(staticPage, "fallback.png");
  checks["3-dev"] = true;
  const live = await browser.newPage();
  live.on("console", (m) => console.error("HOST", m.type(), m.text()));
  live.on("pageerror", (e) => console.error("HOST PAGE", e));
  await live.goto(url);
  await expect(live.locator('[data-state="remote"]')).toBeVisible({ timeout: 30000 });
  await live.getByRole("button").click({ force: true });
  await live.getByRole("button").click({ force: true });
  await expect(live.getByRole("button")).toContainText("clicked 2");
  checks["4-interaction"] = true;
  expect(
    await live.evaluate(
      () =>
        // Module namespace objects differ by design (the federation share re-exports the
        // host's module), so compare the implementation: the hook and element factories.
        (Reflect.get(window, "__composedReactIdentity") as typeof import("react")).useState ===
          (Reflect.get(window, "__composedRemoteReactIdentity") as typeof import("react"))
            .useState &&
        (Reflect.get(window, "__composedReactIdentity") as typeof import("react")).createElement ===
          (Reflect.get(window, "__composedRemoteReactIdentity") as typeof import("react"))
            .createElement,
    ),
  ).toBe(true);
  checks["4-identity"] = true;
  checks["4-interaction"] = true;
  await capture(live, "remote.png");
  const blocked = await browser.newPage();
  const warnings: string[] = [];
  blocked.on("console", (m) => {
    if (m.type() === "warning" && m.text().includes("composed: failed")) warnings.push(m.text());
  });
  await blocked.route("**/remoteEntry.js", (r) => r.fulfill({ status: 404, body: "blocked" }));
  await blocked.goto(url);
  await expect(blocked.locator('[data-state="failed"]')).toHaveText("Hello, Lachlan.", {
    timeout: 30000,
  });
  expect(warnings).toHaveLength(1);
  checks["5"] = true;
  const component = JSON.parse(await cli(["component", "read", "lachieh/hello"]));
  const start = performance.now();
  await cli(
    ["component", "write", "lachieh/hello", "--base", component.base, "--file", "fallback.ts"],
    "export default ({name}: {name:string}) => `Updated **${name}**.`;",
  );
  await expect
    .poll(async () => await (await fetch(url, { signal: AbortSignal.timeout(5000) })).text(), {
      timeout: 2000,
    })
    .toContain("Updated");
  checks["6-ms"] = performance.now() - start;
  expect(checks["6-ms"]).toBeLessThanOrEqual(2000);
  await writeFile(join(evidence, "host.log"), host.output());
} finally {
  await writeFile(join(evidence, "tracer.json"), JSON.stringify({ home, checks }, null, 2));
  await browser?.close();
  if (!process.argv.includes("--inspect-hosts")) {
    await Promise.all([...children].map(stop));
    await rm(home, { recursive: true, force: true });
  }
  console.log(JSON.stringify(checks));
}
