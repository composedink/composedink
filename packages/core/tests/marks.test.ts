import { expect, it } from "vite-plus/test";
import { LoroDoc } from "loro-crdt";
import { snippet } from "../src/model/stash.ts";
it("probes none expansion, unmark, Unicode, concurrent imports and snapshot restart", () => {
  const d = new LoroDoc();
  d.configTextStyle({ dim: { expand: "none" } });
  const t = d.getText("mdx");
  t.insert(0, "A😀B");
  d.commit();
  t.mark({ start: 1, end: 3 }, "dim", true);
  d.commit();
  const branch = d.fork();
  branch.configTextStyle({ dim: { expand: "none" } });
  container(branch).insert(3, "R");
  branch.commit();
  t.insert(1, "L");
  d.commit();
  d.import(branch.export({ mode: "update" }));
  expect(snippet(d, 0, t.length)).toEqual({ text: "AL😀RB", dim: [[2, 4]] });
  const reopened = new LoroDoc();
  reopened.import(d.export({ mode: "snapshot" }));
  expect(snippet(reopened, 0, reopened.getText("mdx").length)).toEqual(snippet(d, 0, t.length));
  reopened.configTextStyle({ dim: { expand: "none" } });
  container(reopened).unmark({ start: 2, end: 4 }, "dim");
  reopened.commit();
  expect(snippet(reopened, 0, 6).dim).toEqual([]);
});
import { createPost, replaceText, importTyping } from "../src/model/text.ts";
import { propose, flip, resolve } from "../src/model/alternatives.ts";
import { head } from "../src/model/read.ts";
import { ghost } from "../src/model/marks.ts";
import { stashList } from "../src/model/stash.ts";
it("preserves inactive marks across flip and crossing typing; repair is a separate commit", () => {
  const d = createPost("p");
  replaceText(d, "One two three.");
  ghost(d, { base: head(d), view: "full", from: 4, to: 7 }, true);
  const a = propose(d, { base: head(d), view: "full", from: 4, to: 7 }, ["TWO"], {
    kind: "human",
  }).alt!;
  flip(d, a, 1);
  flip(d, a, 0);
  expect(snippet(d, 0, d.getText("mdx").length).dim).toEqual([[4, 7]]);
  flip(d, a, 1);
  const replica = d.fork(),
    v = replica.version();
  container(replica).delete(3, 3);
  replica.commit();
  const typingHead = head(replica);
  importTyping(d, replica.export({ mode: "update", from: v }));
  expect(head(d)).not.toBe(typingHead);
  expect(d.forkAt(replica.frontiers()).getText("mdx").toString()).toBe(
    replica.getText("mdx").toString(),
  );
  expect(stashList(d)).toMatchObject([{ text: "two", dim: [[0, 3]] }]);
});
it("ghost resolution inserts inactive versions in original order and marks all of them", () => {
  const d = createPost("p");
  replaceText(d, "One two.");
  const id = propose(d, { base: head(d), view: "full", from: 0, to: 3 }, ["Two", "Three"], {
    kind: "human",
  }).alt!;
  flip(d, id, 1);
  resolve(d, id, "ghost");
  expect(d.getText("mdx").toString()).toBe("TwoOneThree two.");
  expect(snippet(d, 0, d.getText("mdx").length).dim).toEqual([[3, 11]]);
});
it("clips zero-length snippet marks so proposals at a dim boundary have no empty spans", () => {
  const d = createPost("p");
  replaceText(d, "First sentence. Another sentence.");
  ghost(d, { base: head(d), view: "full", from: 0, to: 33 }, true);
  const id = propose(d, { base: head(d), view: "full", from: 0, to: 15 }, ["Agent sentence."], {
    kind: "human",
  }).alt!;
  flip(d, id, 1);
  flip(d, id, 0);
  expect(snippet(d, 0, 15).dim).toEqual([[0, 15]]);
});

function container(d: import("loro-crdt").LoroDoc) {
  return d.getText("mdx");
}
