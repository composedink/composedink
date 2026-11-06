import { expect, it } from "vite-plus/test";
import { mkdtemp, rm, writeFile, mkdir, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { bundle, manifest, sha256 } from "../src/bundle.ts";
import { componentTemplate } from "../src/model/component-template.ts";
it("extracts literal manifest without executing block code", () => {
  const files = componentTemplate("inline");
  expect(manifest(files["block.tsx"]).sample).toEqual({ name: "Lachlan" });
  expect(() =>
    manifest(files["block.tsx"].replace('sample:{name:"Lachlan"}', "sample:{name:process.exit()}")),
  ).toThrow();
});
it("builds a real immutable federated component with a generated frozen lock", async () => {
  const home = await mkdtemp(join(tmpdir(), "composed-bundle-"));
  const previousEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "development";
  try {
    const built = await bundle(
      home,
      "composed:lachieh/hello",
      componentTemplate("inline"),
      "http://127.0.0.1:4848",
    );
    const repeat = await bundle(
      home,
      "composed:lachieh/hello",
      componentTemplate("inline"),
      "http://127.0.0.1:4848",
    );
    expect(repeat.sourceHash).toBe(built.sourceHash);
    expect(repeat.entry).toBe(built.entry);
    const own: Record<string, string> = componentTemplate("inline");
    own["package.json"] = JSON.stringify({
      type: "module",
      dependencies: { "escape-string-regexp": "5.0.0" },
    });
    own["block.tsx"] =
      'import escape from "escape-string-regexp";\n' +
      own["block.tsx"].replace("Hello {name}", '{escape("OWN[DEPENDENCY]")} {name}');
    const dependency = await bundle(home, "composed:lachieh/own", own, "http://127.0.0.1:4848");
    expect(dependency.sourceHash).not.toBe(built.sourceHash);
    own["package.json"] = own["package.json"].replace("5.0.0", "4.0.0");
    const changed = await bundle(home, "composed:lachieh/own", own, "http://127.0.0.1:4848");
    expect(changed.sourceHash).not.toBe(dependency.sourceHash);
    const directory = join(home, "artifacts", built.name);
    const assets = await Promise.all(
      (await readdir(directory, { recursive: true }))
        .filter((name) => name.endsWith(".js"))
        .map((name) => readFile(join(directory, name), "utf8")),
    );
    expect(assets.join("\n")).not.toMatch(
      /react\.(?:development|production)\.js|react-jsx-dev-runtime/,
    );
    const jsHash = sha256(assets.join("\n"));
    await rm(directory, { recursive: true, force: true });
    const rebuilt = await bundle(
      home,
      "composed:lachieh/hello",
      componentTemplate("inline"),
      "http://127.0.0.1:4848",
    );
    expect(rebuilt.sourceHash).toBe(built.sourceHash);
    const rebuiltAssets = await Promise.all(
      (await readdir(directory, { recursive: true }))
        .filter((name) => name.endsWith(".js"))
        .map((name) => readFile(join(directory, name), "utf8")),
    );
    expect(sha256(rebuiltAssets.join("\n"))).toBe(jsHash);
    expect(built.version).toMatch(/^0\.1\.0-dev\.[0-9a-f]{64}$/);
    await mkdir(resolve("../../test-results"), { recursive: true });
    await writeFile(resolve("../../test-results/bundle.json"), JSON.stringify(built, null, 2));
  } finally {
    if (previousEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousEnv;
    await rm(home, { recursive: true, force: true });
  }
}, 120000);
