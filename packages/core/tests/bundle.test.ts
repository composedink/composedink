import { expect, it } from "vite-plus/test";
import { mkdtemp, rm, writeFile, mkdir, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { bundle, manifest } from "../src/bundle.ts";
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
    const directory = join(home, "artifacts", built.name, "assets");
    const assets = await Promise.all(
      (await readdir(directory))
        .filter((name) => name.endsWith(".js"))
        .map((name) => readFile(join(directory, name), "utf8")),
    );
    expect(assets.join("\n")).not.toMatch(
      /react\.(?:development|production)\.js|react-jsx-dev-runtime/,
    );
    expect(built.version).toMatch(/^0\.1\.0-dev\.[0-9a-f]{64}$/);
    await mkdir(resolve("../../test-results"), { recursive: true });
    await writeFile(resolve("../../test-results/bundle.json"), JSON.stringify(built, null, 2));
  } finally {
    if (previousEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousEnv;
    await rm(home, { recursive: true, force: true });
  }
}, 120000);
