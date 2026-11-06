import { createRequire } from "node:module";
import { mkdir, writeFile, cp, readFile, readdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
const root = resolve(import.meta.dirname, "../../..");
const out = join(root, "test-results/plan-11-sea");
await mkdir(out, { recursive: true });
const require = createRequire(join(root, "apps/cli/package.json"));
const viteRequire = createRequire(require.resolve("vite/package.json"));
const { rolldown } = await import(viteRequire.resolve("rolldown"));
try {
  const bundle = await rolldown({ input: join(root, "apps/cli/src/main.ts"), platform: "node" });
  await bundle.write({ file: join(out, "cli.cjs"), format: "cjs" });
  await writeFile(join(out, "bundle-result.txt"), "CJS bundle succeeded\n");
} catch (error) {
  await writeFile(join(out, "bundle-result.txt"), String(error));
}
const rspack = createRequire(require.resolve("@composedink/core/package.json"));
const nativeRoot = resolve(rspack.resolve("@rsbuild/core"), "../../../..");
async function find(dir: string, ending: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const result: string[] = [];
  for (const e of entries) {
    if (e.isDirectory()) result.push(...(await find(join(dir, e.name), ending)));
    else if (e.name.endsWith(ending)) result.push(join(dir, e.name));
  }
  return result;
}
const native = (
  await find(join(root, "node_modules/.pnpm/@rspack+binding-darwin-arm64@2.3.1"), ".node")
)[0];
const wasm = (await find(join(root, "node_modules/.pnpm/loro-crdt@1.17.1"), ".wasm"))[0];
void nativeRoot;

const main = `const sea = require('node:sea'); const fs = require('node:fs'); const vm = require('node:vm');
const path = process.execPath + '.node'; fs.writeFileSync(path, Buffer.from(sea.getAsset('rspack')));
const addon = {exports:{}}; process.dlopen(addon,path); console.log('rspack native loaded',Object.keys(addon.exports).length);
console.log('loro WASM valid',WebAssembly.validate(sea.getAsset('loro')));
console.log('Harper module bytes',sea.getAsset('harper').byteLength);
try { vm.runInThisContext(Buffer.from(sea.getAsset('cli')).toString()); } catch(e) { console.log('CLI source failed:',e.message); process.exitCode=2; }
fs.unlinkSync(path);`;
await writeFile(join(out, "main.cjs"), main);
await writeFile(
  join(out, "sea.json"),
  JSON.stringify({
    main: join(out, "main.cjs"),
    output: join(out, "sea.blob"),
    disableExperimentalSEAWarning: true,
    assets: {
      cli: join(root, "apps/cli/src/main.ts"),
      rspack: native,
      loro: wasm,
      harper: join(root, "packages/lint/node_modules/harper.js/dist/binaryInlined.js"),
    },
  }),
);
function run(command: string, args: string[], clean = false) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    env: clean ? { PATH: "/usr/bin:/bin", HOME: process.env.HOME } : process.env,
  });
  console.log(
    JSON.stringify({
      command,
      args,
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
    }),
  );
  return result;
}
run(process.execPath, ["--experimental-sea-config", join(out, "sea.json")]);
const executable = join(out, "composed-sea");
await cp(process.execPath, executable);
run("/usr/bin/codesign", ["--remove-signature", executable]);
run(process.execPath, [
  join(root, "node_modules/postject/dist/cli.js"),
  executable,
  "NODE_SEA_BLOB",
  join(out, "sea.blob"),
  "--sentinel-fuse",
  "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
  "--macho-segment-name",
  "NODE_SEA",
]);
run("/usr/bin/codesign", ["--sign", "-", executable]);
run(executable, [], true);
console.log(await readFile(join(out, "bundle-result.txt"), "utf8"));
