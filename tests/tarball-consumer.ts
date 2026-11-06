import { cp, mkdir, readFile, writeFile, realpath, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
const root = resolve(import.meta.dirname, ".."),
  evidence = join(root, "test-results"),
  fixture = join(evidence, "tarball-consumer");
await rm(fixture, { recursive: true, force: true });
await mkdir(fixture, { recursive: true });
async function run(args: string[], cwd: string) {
  await new Promise<void>((done, fail) => {
    const child = spawn("mise", ["exec", "--", ...args], {
      cwd,
      env: args.includes("build")
        ? { ...process.env, NODE_OPTIONS: `--import=${join(root, "tests/deny-network.mjs")}` }
        : process.env,
      stdio: "inherit",
    });
    child.on("error", fail);
    child.on("exit", (code) =>
      code === 0 ? done() : fail(Error(`${args.join(" ")} exited ${code}`)),
    );
  });
}
const archives: Record<string, string> = {};
for (const name of ["blocks", "host-runtime", "host-tanstack"]) {
  const cwd = join(root, "packages", name);
  await run(["vp", "pack"], cwd);
  await run(["pnpm", "pack", "--pack-destination", evidence], cwd);
  archives[`@composedink/${name}`] = `file:${join(evidence, `composedink-${name}-0.0.0.tgz`)}`;
}
const example = join(root, "examples/host-tanstack");
await cp(example, fixture, {
  recursive: true,
  filter: (p) => !p.includes("/node_modules") && !p.includes("/dist") && !p.includes("/.vite"),
});
const pkg = JSON.parse(await readFile(join(example, "package.json"), "utf8"));
for (const section of ["dependencies", "devDependencies"])
  for (const [name] of Object.entries(pkg[section])) {
    if (archives[name]) pkg[section][name] = archives[name];
    else
      pkg[section][name] = JSON.parse(
        await readFile(join(example, "node_modules", name, "package.json"), "utf8"),
      ).version;
  }
pkg.dependencies = { ...pkg.dependencies, ...archives };
pkg.pnpm = { overrides: { ...archives, vite: "npm:@voidzero-dev/vite-plus-core@1.5.0" } };
await writeFile(join(fixture, "package.json"), JSON.stringify(pkg, null, 2));
await writeFile(
  join(fixture, "pnpm-workspace.yaml"),
  "packages: []\noverrides:\n" +
    Object.entries({ ...archives, vite: "npm:@voidzero-dev/vite-plus-core@1.5.0" })
      .map(([key, value]) => `  ${JSON.stringify(key)}: ${JSON.stringify(value)}`)
      .join("\n") +
    "\n",
);
const config = JSON.parse(await readFile(join(example, "tsconfig.json"), "utf8"));
delete config.extends;
config.compilerOptions.module = "ESNext";
config.compilerOptions.moduleResolution = "Bundler";
config.compilerOptions.target = "ES2022";
await writeFile(join(fixture, "tsconfig.json"), JSON.stringify(config));
await mkdir(join(fixture, "content/tracer"), { recursive: true });
const proof = JSON.parse(await readFile(join(evidence, "release-proof.json"), "utf8"));
await writeFile(join(fixture, "content/tracer/composed.lock.json"), JSON.stringify(proof.lock));
await cp(join(evidence, "exported.mdx"), join(fixture, "content/tracer/index.mdx"));
await run(["pnpm", "install", "--ignore-scripts"], fixture);
for (const name of Object.keys(archives)) {
  const path = await realpath(join(fixture, "node_modules", name));
  assert(path.startsWith(fixture + "/"));
  const installed = JSON.parse(await readFile(join(path, "package.json"), "utf8"));
  assert(!JSON.stringify(installed.exports).includes("/src/"));
  assert(!JSON.stringify(installed).includes("workspace:"));
}
process.env.COMPOSED_DENY_PORT = new URL(proof.publication.url).port;
await run(["node", "node_modules/@rsbuild/core/bin/rsbuild.js", "build"], fixture);
assert(
  (await readFile(join(fixture, "dist/client/posts/tracer/index.html"), "utf8")).includes(
    "Lachlan",
  ),
);
await writeFile(
  join(evidence, "tarball-consumer-proof.json"),
  JSON.stringify({ archives, workspaceLinks: false, build: true }, null, 2),
);
