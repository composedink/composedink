import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { expect, it, vi } from "vite-plus/test";
import { remarkComposed } from "../src/remark.ts";
it("validates instances after defaults without hashing formatter-edited MDX and warns once per preview post", async () => {
  const directory = await mkdtemp(join(tmpdir(), "remark-"));
  const path = join(directory, "index.mdx");
  const props = { name: "World" };
  const hash = createHash("sha256").update(JSON.stringify(props)).digest("hex");
  const block = {
    id: "composed:test/hello",
    version: "0.1.0",
    entry: "http://127.0.0.1:1/remoteEntry.js",
    sourceHash: "source",
    kind: "inline",
    props: { type: "object", properties: { name: { type: "string", default: "World" } } },
    instances: { [hash]: { props, markdown: "Hello **World**" } },
  };
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const tree = () => ({
    type: "root",
    children: [
      {
        type: "mdxJsxTextElement",
        name: "Hello",
        attributes: [],
        position: { start: { line: 3 } },
        children: [],
      },
    ],
  });
  try {
    await writeFile(path, "Formatting changed: <Hello />");
    await writeFile(
      join(directory, "composed.lock.json"),
      JSON.stringify({
        composed: 1,
        doc: "post",
        base: "base",
        view: "clean",
        mode: "preview",
        sha256: "deliberately-does-not-match-mdx",
        blocks: { Hello: block },
      }),
    );
    const transform = remarkComposed({ production: true });
    await transform(tree(), { path });
    await transform(tree(), { path });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("composed export post");
    block.instances = {};
    await writeFile(
      join(directory, "composed.lock.json"),
      JSON.stringify({
        composed: 1,
        doc: "post",
        base: "base",
        view: "clean",
        mode: "release",
        sha256: "unused",
        blocks: { Hello: block },
      }),
    );
    await expect(transform(tree(), { path })).rejects.toThrow(
      `${path}:3: composed export post: missing instance Hello`,
    );
  } finally {
    warn.mockRestore();
    await rm(directory, { recursive: true, force: true });
  }
});
