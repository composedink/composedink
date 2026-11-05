import { expect, it } from "vite-plus/test";
import { parseLock } from "../src/index.ts";
const lock = {
  composed: 1,
  mode: "preview",
  doc: "tracer",
  base: "base",
  view: "full",
  sha256: "hash",
  blocks: {
    Hello: {
      id: "composed:lachieh/hello",
      version: "0.1.0-dev.hash",
      kind: "inline",
      entry: "http://127.0.0.1:4848/remoteEntry.js",
      sourceHash: "hash",
      props: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
      instances: { instance: { props: { name: "Lachlan" }, markdown: "Hello, **Lachlan**." } },
    },
  },
};
it("accepts the preview descriptor and rejects unsafe URLs or malformed instance props", () => {
  expect(parseLock(lock)).toEqual(lock);
  expect(() => parseLock({ ...lock, composed: 2 })).toThrow();
  expect(() =>
    parseLock({
      ...lock,
      blocks: { Hello: { ...lock.blocks.Hello, entry: "javascript:alert(1)" } },
    }),
  ).toThrow();
  expect(() =>
    parseLock({
      ...lock,
      blocks: {
        Hello: {
          ...lock.blocks.Hello,
          instances: { instance: { props: { name: 42 }, markdown: "invalid" } },
        },
      },
    }),
  ).toThrow();
});
