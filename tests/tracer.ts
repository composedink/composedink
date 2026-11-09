import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, cp, symlink, mkdir, writeFile, readFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:net";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { chromium, expect, type Page } from "@playwright/test";
import { assertInteractiveRemote } from "../examples/host-tanstack/tests/tracer.spec.ts";
const root = resolve(import.meta.dirname, "..");
console.log("runtime", process.version, process.execPath);
const evidence = join(root, "test-results");
await mkdir(evidence, { recursive: true });
const coreRequire = createRequire(join(root, "packages/core/package.json"));
const hostRequire = createRequire(join(root, "examples/host-tanstack/package.json"));
const rsbuildRequire = createRequire(coreRequire.resolve("@rsbuild/core"));
const versions: Record<string, string> = { node: process.version };
for (const [name, resolver] of [
  ["@rsbuild/core", coreRequire],
  ["@rspack/core", rsbuildRequire],
  ["@rsbuild/plugin-react", coreRequire],
  ["@module-federation/rsbuild-plugin", coreRequire],
  ["@tanstack/react-start", hostRequire],
  ["react", hostRequire],
  ["react-dom", hostRequire],
] as const) {
  for (const directory of resolver.resolve.paths(name) ?? []) {
    let metadata: unknown;
    try {
      metadata = JSON.parse(await readFile(join(directory, name, "package.json"), "utf8"));
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
      continue;
    }
    if (
      !metadata ||
      typeof metadata !== "object" ||
      !("version" in metadata) ||
      typeof metadata.version !== "string"
    )
      throw Error(`Missing package version: ${name}`);
    versions[name] = metadata.version;
    break;
  }
  if (!versions[name]) throw Error(`Missing package: ${name}`);
}
await writeFile(join(evidence, "versions.json"), JSON.stringify(versions, null, 2));

const home = await mkdtemp(join(tmpdir(), "composed-tracer-"));
const example = join(home, "example");
const children = new Set<ChildProcess>();
const releaseServer = process.env.COMPOSED_RELEASE_SERVER;
const releaseToken = process.env.COMPOSED_RELEASE_TOKEN;
if (Boolean(releaseServer) !== Boolean(releaseToken))
  throw Error("Set both COMPOSED_RELEASE_SERVER and COMPOSED_RELEASE_TOKEN");
// --minor uses only this fresh authority's releases, so every run starts at 0.1.0.
// A unique scope avoids immutable-server collisions while keeping Hello and the MDX unchanged.
const scope = releaseServer ? `verify-${Date.now()}-${randomUUID()}` : "lachieh";
const component = `${scope}/hello`;
const env = {
  ...process.env,
  COMPOSED_HOME: home,
  COMPOSED_TOKEN: releaseToken ?? "local-test-token",
  // The local artifact server (plan 16) refuses to start without a bootstrap token while it has
  // no account; the tracer never signs in.
  COMPOSED_BOOTSTRAP_TOKEN: "tracer-bootstrap",
  VP_NODE_VERSION: "22.22.3",
};
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
  const child = spawn(command, args, {
    cwd,
    env: args.includes("build")
      ? { ...env, NODE_OPTIONS: `--import=${join(root, "tests/deny-network.mjs")}` }
      : env,
    detached: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
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
    "--no-warnings=ExperimentalWarning",
    join(root, "apps/cli/src/main.ts"),
    ...args,
  ]);
  run.child.stdin!.end(input);
  return run.done;
}
async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const done = new Promise<void>((r) => child.once("exit", () => r()));
  if (child.pid) process.kill(-child.pid, "SIGTERM");
  await done;
}
async function reloadAfterLiveUpdate(page: Page) {
  await page.waitForLoadState("networkidle");
  try {
    await page.reload();
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("ERR_ABORTED")) throw error;
    await page.waitForLoadState("load");
  }
  await page.waitForLoadState("networkidle");
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
      "--no-warnings=ExperimentalWarning",
      join(root, "apps/cli/src/main.ts"),
      "studio",
    ]);
    await expect.poll(() => run.output(), { timeout: 30000 }).toContain('"ready":true');
    return run;
  }
  let owner = await studio();
  await cli(["new", "post", "tracer"]);
  await cli(["component", "create", component, "--kind", "inline"]);
  await cli(["deps", "add", "tracer", "Hello", `composed:${component}@dev`]);
  const instrumented = JSON.parse(await cli(["component", "read", component]));
  await cli(
    ["component", "write", component, "--base", instrumented.base, "--file", "block.tsx"],
    instrumented.files["block.tsx"].replace(
      " const [n,",
      ' if (typeof window !== "undefined") Object.assign(window, {__composedRemoteReactIdentity:React});\n const [n,',
    ) +
      '\nexport const __composedReactIdentity = React;\nif (typeof window !== "undefined") Reflect.set(window, "__composedSentinel", "COMPOSED_HELLO_IMPLEMENTATION_SENTINEL");\n',
  );
  const ownDependency = JSON.parse(await cli(["component", "read", component]));
  await cli(
    ["component", "write", component, "--base", ownDependency.base, "--file", "package.json"],
    JSON.stringify({ type: "module", dependencies: { "escape-string-regexp": "5.0.0" } }),
  );
  const ownBlock = JSON.parse(await cli(["component", "read", component]));
  await cli(
    ["component", "write", component, "--base", ownBlock.base, "--file", "block.tsx"],
    'import escape from "escape-string-regexp";\n' +
      ownBlock.files["block.tsx"] +
      '\nif(typeof window!=="undefined") Reflect.set(window,"__ownDependency",escape("OWN[DEPENDENCY]"));\n',
  );
  const routerPath = join(example, "src/router.tsx");
  await writeFile(
    routerPath,
    (await readFile(routerPath, "utf8")) +
      '\nimport * as React from "react";\nif (typeof window !== "undefined") Object.assign(window,{__composedReactIdentity:React});\n',
  );
  browser = await chromium.launch({
    channel: "chromium",
    args: ["--disable-background-timer-throttling", "--disable-renderer-backgrounding"],
  });
  browser.on("disconnected", () => console.error("BROWSER disconnected"));
  const editorContext = await browser.newContext();
  const page = await editorContext.newPage();
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
  await editorContext.setOffline(true);
  await page.locator(".cm-content").fill(source + "Offline edit");
  await expect(page.getByRole("status")).toContainText("Unsaved");
  await editorContext.setOffline(false);
  await expect(page.getByRole("status")).toHaveText("Saved");
  expect(await cli(["cat", "tracer"])).toBe(source + "Offline edit");
  await stop(owner.child);
  // Plan 18: disconnected with nothing pending reads "Offline"; pending edits add "Unsaved changes".
  await expect(page.getByRole("status")).toContainText("Offline");
  await page.locator(".cm-content").fill(source);
  owner = await studio();
  await expect(page.getByRole("status")).toHaveText("Saved", { timeout: 20000 });
  await page.close();
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
  await writeFile(join(evidence, "exported.mdx"), source);
  await writeFile(join(evidence, "exported.lock.json"), JSON.stringify(lock, null, 2));
  await writeFile(join(evidence, "durable-read.txt"), await cli(["cat", "tracer"]));
  const releasePort = await port();
  const serverUrl = releaseServer ?? `http://127.0.0.1:${releasePort}`;
  Object.assign(env, {
    COMPOSED_STORAGE: join(home, "cdn"),
    PORT: String(releasePort),
    COMPOSED_DENY_PORT: String(releasePort),
    COMPOSED_ALLOW_HOST: releaseServer ? new URL(releaseServer).host : "",
  });
  const cdn = releaseServer
    ? undefined
    : launch(process.execPath, [
        "--experimental-strip-types",
        join(root, "apps/server/src/main.ts"),
      ]);
  if (cdn)
    await expect
      .poll(async () => {
        try {
          return (await fetch(`${serverUrl}/healthz`)).status;
        } catch {
          return 0;
        }
      })
      .toBe(200);
  const sidecarPath = join(example, "content/tracer/composed.lock.json");
  const sidecarBytes = await readFile(sidecarPath, "utf8");
  await rm(sidecarPath);
  const missingSidecar = launch(
    join(root, "examples/host-tanstack/node_modules/.bin/rsbuild"),
    ["build"],
    example,
  );
  await missingSidecar.done;
  expect(missingSidecar.output()).toContain("Error: Expected component `Hello` to be defined");
  await writeFile(join(evidence, "missing-sidecar-build.log"), missingSidecar.output());
  await writeFile(sidecarPath, sidecarBytes);
  const build = launch(
    join(root, "examples/host-tanstack/node_modules/.bin/rsbuild"),
    ["build"],
    example,
  );
  await build.done.finally(() => writeFile(join(evidence, "tracer-build.log"), build.output()));
  expect(build.output().match(/preview lock renders fallback only/g)?.length).toBe(1);
  await writeFile(join(evidence, "preview-build.log"), build.output());
  const previewServer = launch(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import {createServer} from "node:http";import {readFile} from "node:fs/promises";import {join} from "node:path";createServer(async(req,res)=>{try{const p=req.url.split("?")[0];res.setHeader("content-type",p.endsWith(".js")?"application/javascript":"text/html");res.end(await readFile(join(${JSON.stringify(join(example, "dist/client"))},p==="/posts/tracer"?"/posts/tracer/index.html":p)));}catch{res.writeHead(404).end();}}).listen(${hostPort},"127.0.0.1");`,
    ],
    example,
  );
  const previewPage = await browser.newPage();
  let remoteRequests = 0;
  previewPage.on("request", (r) => {
    if (r.url().includes("remoteEntry.js")) remoteRequests++;
  });
  await expect
    .poll(async () => {
      try {
        return (await fetch(`http://127.0.0.1:${hostPort}/posts/tracer`)).status;
      } catch {
        return 0;
      }
    })
    .toBe(200);
  await previewPage.goto(`http://127.0.0.1:${hostPort}/posts/tracer`);
  await expect(previewPage.locator('[data-state="fallback"]')).toBeVisible();
  await previewPage.waitForLoadState("networkidle");
  expect(remoteRequests).toBe(0);
  await previewPage.close();
  await stop(previewServer.child);

  await cli(["config", "scope", scope, "--server", serverUrl, "--token-ref", "COMPOSED_TOKEN"]);
  const publication = JSON.parse(
    await cli(["component", "publish", component, "--minor", "--request", "tracer-publish"]),
  );
  const remoteBytes = await (await fetch(publication.url)).text();
  const retry = await fetch(publication.url, {
    method: "PUT",
    headers: { authorization: `Bearer ${env.COMPOSED_TOKEN}` },
    body: remoteBytes,
  });
  expect(retry.status).toBe(200);
  expect(
    (
      await fetch(publication.url, {
        method: "PUT",
        headers: { authorization: `Bearer ${env.COMPOSED_TOKEN}` },
        body: "conflicting",
      })
    ).status,
  ).toBe(409);
  await cli(["deps", "pin", "tracer", "Hello", publication.version]);
  await cli(["export", "tracer", "--to", join(example, "content")]);
  const released = JSON.parse(
    await readFile(join(example, "content/tracer/composed.lock.json"), "utf8"),
  );
  expect(released.mode).toBe("release");
  expect(released.blocks.Hello.entry).toBe(publication.url);
  const beforeOutside = JSON.parse(await cli(["cat", "tracer", "--json"]));
  await cli(
    ["apply", "tracer", "--base", beforeOutside.base, "--direct", "--i-am-human"],
    beforeOutside.text + "\n\nStudio concurrent edit.\n",
  );
  await writeFile(join(example, "content/tracer/index.mdx"), source + "\n\nOutside file edit.\n");
  await cli(["export", "tracer"]);
  const reconciledText = await cli(["cat", "tracer"]);
  expect(reconciledText).toContain("Studio concurrent edit.");
  expect(reconciledText).toContain("Outside file edit.");
  await writeFile(
    join(evidence, "outside-edit-proof.json"),
    JSON.stringify({ base: beforeOutside.base, text: reconciledText }, null, 2),
  );
  const releaseBuild = launch(
    join(root, "examples/host-tanstack/node_modules/.bin/rsbuild"),
    ["build"],
    example,
  );
  await releaseBuild.done.finally(() =>
    writeFile(join(evidence, "release-build.log"), releaseBuild.output()),
  );
  expect(releaseBuild.output()).not.toContain("preview lock renders fallback only");
  const prerender = await readFile(join(example, "dist/client/posts/tracer/index.html"), "utf8");
  await writeFile(join(evidence, "prerender.html"), prerender);
  const serverTrace = await readFile(join(example, "dist/server/module-trace.json"), "utf8");
  await writeFile(join(evidence, "server-module-trace.json"), serverTrace);
  const modules: string[] = JSON.parse(serverTrace);
  expect(
    modules.filter(
      (id) =>
        /(?:^|\/)(?:block\.tsx|fallback\.ts)$/.test(id) &&
        !id.includes("host-tanstack/src/block.tsx"),
    ),
  ).toEqual([]);
  async function assetFiles(directory: string): Promise<string[]> {
    return (
      await Promise.all(
        (await readdir(directory, { withFileTypes: true })).map(async (entry) =>
          entry.isDirectory()
            ? assetFiles(join(directory, entry.name))
            : [join(directory, entry.name)],
        ),
      )
    ).flat();
  }
  const hostAssets = await assetFiles(join(example, "dist"));
  for (const path of hostAssets.filter((p) => p.endsWith(".js"))) {
    expect(await readFile(path, "utf8")).not.toContain("COMPOSED_HELLO_IMPLEMENTATION_SENTINEL");
  }
  const productionServer = launch(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import {createServer} from "node:http"; import {readFile} from "node:fs/promises"; import {join} from "node:path"; createServer(async (req,res)=>{try{let p=req.url.split("?")[0];if(p==="/"||p==="/posts/tracer"||p==="/posts/tracer/")p="/posts/tracer/index.html";res.setHeader("content-type",p.endsWith(".js")?"application/javascript":p.endsWith(".css")?"text/css":"text/html");res.end(await readFile(join(${JSON.stringify(join(example, "dist/client"))},p)));}catch{res.writeHead(404).end();}}).listen(${hostPort},"127.0.0.1");`,
    ],
    example,
  );
  const productionContext = await browser.newContext({ javaScriptEnabled: false });
  const productionPage = await productionContext.newPage();
  await expect
    .poll(async () => {
      try {
        return (await fetch(`http://127.0.0.1:${hostPort}`)).status;
      } catch {
        return 0;
      }
    })
    .toBe(200);
  await productionPage.goto(`http://127.0.0.1:${hostPort}/posts/tracer`);
  await expect(
    productionPage.locator(`span[data-composed="composed:${component}"][data-state="fallback"]`),
  ).toHaveText("Hello, Lachlan.");
  await expect(productionPage.locator("[data-composed] strong")).toHaveText("Lachlan");
  await productionPage
    .screenshot({ path: join(evidence, "production-fallback.png"), timeout: 10000 })
    .catch(async (e) =>
      writeFile(join(evidence, "production-fallback.png.failure.txt"), String(e)),
    );
  await productionContext.close();
  const releasedPage = await browser.newPage();
  await releasedPage.goto(`http://127.0.0.1:${hostPort}/posts/tracer`);
  await expect(releasedPage.locator('[data-state="remote"]')).toBeVisible({ timeout: 30000 });
  await assertInteractiveRemote(releasedPage);
  await releasedPage.close();
  const blockedRelease = await browser.newPage();
  await blockedRelease.route("**/remoteEntry.js", (route) => route.abort());
  await blockedRelease.goto(`http://127.0.0.1:${hostPort}/posts/tracer`);
  await expect(blockedRelease.locator('[data-state="failed"]')).toHaveText("Hello, Lachlan.", {
    timeout: 30000,
  });
  await blockedRelease.close();
  const releaseProof = JSON.stringify(
    {
      publication,
      sha256: createHash("sha256").update(remoteBytes).digest("hex"),
      retry: retry.status,
      conflict: 409,
      lock: released,
      scope: { name: scope, server: serverUrl, tokenRef: "COMPOSED_TOKEN" },
      fallback: true,
      interactiveRemote: true,
      reactIdentity: true,
      blockedRemote: true,
    },
    null,
    2,
  );
  await writeFile(join(evidence, "release-proof.json"), releaseProof);
  if (releaseServer) await writeFile(join(evidence, "release-proof-staging.json"), releaseProof);
  await stop(productionServer.child);
  if (cdn) await stop(cdn.child);
  await cli(["deps", "pin", "tracer", "Hello", "dev"]);
  await cli(["preview", "tracer", "--to", join(example, "content")]);
  checks["3"] = true;
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
      .screenshot({ path: join(evidence, name), timeout: 10000, animations: "disabled" })
      .catch(async (e) => {
        await writeFile(join(evidence, name + ".failure.txt"), String(e));
      });
  };
  await capture(staticPage, "fallback.png");
  checks["3-dev"] = true;
  const live = await browser.newPage();
  live.on("console", (m) => console.error("HOST", m.type(), m.text()));
  live.on("pageerror", (e) => console.error("HOST PAGE", e));
  const loadedScripts: { url: string; body: string }[] = [];
  const scriptReads: Promise<void>[] = [];
  live.on("response", (response) => {
    if (response.request().resourceType() === "script")
      scriptReads.push(
        response.text().then((body) => {
          loadedScripts.push({ url: response.url(), body });
        }),
      );
  });
  await live.goto(url);
  await live.waitForLoadState("networkidle");
  await assertInteractiveRemote(live);
  checks["4-interaction"] = true;
  checks["4-identity"] = true;
  live.removeAllListeners("response");
  await Promise.all(scriptReads);
  const reactImplementations = loadedScripts.filter(({ body }) =>
    /(?:function requireReact\(|react\.development\.js|react\.production\.js)/.test(body),
  );

  expect(reactImplementations).toHaveLength(1);
  await writeFile(
    join(evidence, "loaded-assets.json"),
    JSON.stringify(
      {
        scripts: loadedScripts.map(({ url }) => url),
        reactImplementations: reactImplementations.map(({ url }) => url),
        hostSentinelAbsent: true,
        sharedFunctionsIdentical: true,
      },
      null,
      2,
    ),
  );
  checks["4"] = true;
  await capture(live, "remote.png");
  expect(await live.evaluate(() => Reflect.get(window, "__ownDependency"))).toBe(
    "OWN\\[DEPENDENCY\\]",
  );
  checks["own-dependency"] = true;
  const hostJs = await readdir(join(example, "dist/client"), { recursive: true });
  for (const asset of hostJs.filter((name) => name.endsWith(".js")))
    expect(await readFile(join(example, "dist/client", asset), "utf8")).not.toContain(
      "OWN[DEPENDENCY]",
    );
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
  await writeFile(join(evidence, "warnings.json"), JSON.stringify(warnings));
  await capture(blocked, "failed.png");
  const ownSentinel = async () => {
    try {
      return await live.evaluate(() => Reflect.get(window, "__ownDependency"));
    } catch (error) {
      if (String(error).includes("Execution context was destroyed")) return undefined;
      throw error;
    }
  };
  const editDirectory = join(home, "checkout");
  const edit = launch(process.execPath, [
    "--experimental-strip-types",
    join(root, "apps/cli/src/main.ts"),
    "component",
    "edit",
    component,
    editDirectory,
  ]);
  await expect.poll(() => edit.output(), { timeout: 10000 }).toContain('"editing"');
  const ownerBefore = JSON.parse(await readFile(join(home, "owner.json"), "utf8"));
  const lockBeforeFailure = await readFile(
    join(example, "content/tracer/composed.lock.json"),
    "utf8",
  );
  const checkedBlock = await readFile(join(editDirectory, "block.tsx"), "utf8");
  await writeFile(
    join(editDirectory, "block.tsx"),
    checkedBlock.replace('sample:{name:"Lachlan"}', "sample:{name:process.exit()}"),
  );
  await expect.poll(() => edit.output(), { timeout: 10000 }).toContain("BuildFailed");
  expect(await readFile(join(example, "content/tracer/composed.lock.json"), "utf8")).toBe(
    lockBeforeFailure,
  );
  await reloadAfterLiveUpdate(live);
  await expect.poll(ownSentinel, { timeout: 10000 }).toBe("OWN\\[DEPENDENCY\\]");
  await writeFile(join(editDirectory, "block.tsx"), checkedBlock);
  await expect
    .poll(async () => JSON.parse(await cli(["component", "read", component])).files["block.tsx"], {
      timeout: 10000,
    })
    .toBe(checkedBlock);
  const start = performance.now();
  await writeFile(
    join(editDirectory, "fallback.ts"),
    "export default ({name}: {name:string}) => `Updated **${name}**.`;",
  );
  await expect
    .poll(async () => await (await fetch(url, { signal: AbortSignal.timeout(5000) })).text(), {
      timeout: 2000,
    })
    .toContain("Updated");
  checks["6-ms"] = performance.now() - start;
  expect(checks["6-ms"]).toBeLessThanOrEqual(2000);
  await writeFile(join(evidence, "updated-ssr.html"), await (await fetch(url)).text());
  checks["file-sync-ms"] = checks["6-ms"];
  expect(JSON.parse(await readFile(join(home, "owner.json"), "utf8")).pid).toBe(ownerBefore.pid);
  const codeStart = performance.now();
  await writeFile(
    join(editDirectory, "block.tsx"),
    checkedBlock.replace("OWN[DEPENDENCY]", "OWN[UPDATED]"),
  );
  await expect
    .poll(ownSentinel, {
      timeout: 2000,
      intervals: [20],
    })
    .toBe("OWN\\[UPDATED\\]");
  checks["code-save-ms"] = performance.now() - codeStart;
  expect(checks["code-save-ms"]).toBeLessThanOrEqual(2000);
  const priorDependencyLock = await readFile(
    join(example, "content/tracer/composed.lock.json"),
    "utf8",
  );
  await live.evaluate(() => Reflect.set(window, "__ownDependency", undefined));
  const dependencyStart = performance.now();
  await writeFile(
    join(editDirectory, "package.json"),
    JSON.stringify({ type: "module", dependencies: { "escape-string-regexp": "4.0.0" } }),
  );
  await expect
    .poll(async () => await readFile(join(example, "content/tracer/composed.lock.json"), "utf8"), {
      timeout: 2000,
      intervals: [20],
    })
    .not.toBe(priorDependencyLock);
  await expect
    .poll(ownSentinel, {
      timeout: 2000,
      intervals: [20],
    })
    .toBe("OWN\\[UPDATED\\]");
  checks["dependency-save-ms"] = performance.now() - dependencyStart;
  expect(checks["dependency-save-ms"]).toBeLessThanOrEqual(2000);
  await reloadAfterLiveUpdate(live);
  await live.waitForLoadState("networkidle");
  await assertInteractiveRemote(live);
  const prose = JSON.parse(await cli(["cat", "tracer", "--json"]));
  await cli(
    ["apply", "tracer", "--base", prose.base, "--direct", "--i-am-human"],
    prose.text + "\n\nProse-only refresh.\n",
  );
  await expect
    .poll(async () => await (await fetch(url)).text(), { timeout: 2000 })
    .toContain("Prose-only refresh");
  checks["prose-refresh"] = true;
  await writeFile(
    join(evidence, "authoring.json"),
    JSON.stringify(
      {
        ownDependency: "escape-string-regexp",
        version: "4.0.0",
        hostExcludesSentinel: true,
        reactIdentity: true,
        checks,
      },
      null,
      2,
    ),
  );
  await stop(edit.child);
  const retainedPair = await readFile(join(example, "content/tracer/composed.lock.json"), "utf8");
  await stop(owner.child);
  owner = await studio();
  expect(await readFile(join(example, "content/tracer/composed.lock.json"), "utf8")).toBe(
    retainedPair,
  );
  checks["last-good-restart"] = true;
  const lockPath = join(example, "content/tracer/composed.lock.json");
  const changedLock = JSON.parse(await readFile(lockPath, "utf8"));
  const instance = Object.values(changedLock.blocks.Hello.instances)[0];
  if (!instance || typeof instance !== "object" || !("markdown" in instance))
    throw Error("Missing instance");
  instance.markdown = "Lock-only **invalidation**.";
  await writeFile(lockPath, JSON.stringify(changedLock));
  await expect
    .poll(async () => await (await fetch(url)).text(), { timeout: 2000 })
    .toContain("Lock-only");
  checks["6"] = true;
  await writeFile(join(evidence, "lock-only-ssr.html"), await (await fetch(url)).text());
  await writeFile(join(evidence, "host.log"), host.output());
} finally {
  await writeFile(join(evidence, "tracer.json"), JSON.stringify({ home, checks }, null, 2));
  await writeFile(
    join(evidence, "assertions.json"),
    JSON.stringify(
      Object.fromEntries(
        [1, 2, 3, 4, 5, 6].map((n) => [
          n,
          {
            pass: checks[String(n)] === true,
            evidence:
              n === 3
                ? ["prerender.html", "server-module-trace.json", "production-fallback.png"]
                : n === 4
                  ? ["loaded-assets.json", "remote.png"]
                  : n === 5
                    ? ["warnings.json", "failed.png"]
                    : n === 6
                      ? ["updated-ssr.html", "lock-only-ssr.html", "tracer.json"]
                      : ["tracer.json", "durable-read.txt", "exported.mdx", "exported.lock.json"],
          },
        ]),
      ),
      null,
      2,
    ),
  );
  await browser?.close();
  if (!process.argv.includes("--inspect-hosts")) {
    await Promise.all([...children].map(stop));
    await rm(home, { recursive: true, force: true });
  }
  console.log(JSON.stringify(checks));
}
