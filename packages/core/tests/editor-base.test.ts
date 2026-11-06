import { head } from "../src/model/read";
import { expect, it } from "vite-plus/test";
import { createComponent, writeFiles } from "../src/model/files";
it("rejects an unknown editor operation base without changing the current files", () => {
  const doc = createComponent("composed:a/block", { "note.txt": "current" });
  expect(() => writeFiles(doc, "not-a-frontier", { "note.txt": "wrong" })).toThrow("UnknownBase");
  const foreign = createComponent("composed:a/other", { "x.txt": "foreign" });
  expect(() => writeFiles(doc, head(foreign), { "note.txt": "wrong" })).toThrow("UnknownBase");
  expect(doc.getMap("files").toJSON()).toEqual({ "note.txt": "current" });
});
