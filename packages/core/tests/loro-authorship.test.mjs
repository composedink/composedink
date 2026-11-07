import { LoroDoc } from "loro-crdt";
import { it, expect as assert } from "vite-plus/test";
import { proposeBranch } from "../src/model/apply.ts";
import { flip as flipAlternative } from "../src/model/alternatives.ts";
const original =
  "First paragraph.\n\nHuman paragraph.\n\nThird paragraph.\n\nFourth sentence. Another sentence.\n\nLast paragraph.";
const quote = "Fourth sentence. Another sentence.";
const from = original.indexOf(quote),
  to = from + quote.length;
const run = (kind, humanPeer, agentPeer) => {
  const base = new LoroDoc();
  base.setPeerId("1");
  base.getMap("meta").set("kind", "post");
  base.getMap("meta").set("slug", "post");
  base.getText("mdx").insert(0, original);
  base.commit();
  const liveStart = base.getText("mdx").getCursor(from, -1),
    liveEnd = base.getText("mdx").getCursor(to - 1, 1);
  const human = base.fork();
  human.setPeerId(humanPeer);
  const t = human.getText("mdx");
  if (kind === "edges") {
    t.insert(to, " RIGHT");
    t.insert(from, "LEFT ");
  }
  if (kind === "inside-edit") t.insert(original.indexOf("Another"), "Human ");
  if (kind === "first-sentence-deletion") t.delete(from, "Fourth sentence. ".length);
  if (kind === "paragraph-2")
    t.update(original.replace("Human paragraph.", "Human edited paragraph."));
  human.commit();
  const agentUnit = "Agent sentence. Another sentence.";
  const agentSource = original.replace(quote, agentUnit);
  const agent = base.fork();
  agent.setPeerId(agentPeer);
  agent.getText("mdx").update(agentSource);
  agent.commit();
  const af = agentSource.indexOf(agentUnit);
  const exStart = agent.getText("mdx").getCursor(af, -1),
    exEnd = agent.getText("mdx").getCursor(af + agentUnit.length - 1, 1);
  const merged = human.fork();
  merged.import(agent.export({ mode: "update", from: base.version() }));
  const mt = merged.getText("mdx");
  const s = mt.toString();
  const pos = (doc, c) => {
    const r = doc.getCursorPos(c);
    return r.offset + (r.side === 1 ? 1 : 0);
  };
  const exL = pos(merged, exStart),
    exR = pos(merged, exEnd),
    liveL = pos(merged, liveStart),
    liveR = pos(merged, liveEnd);
  let version = "";
  for (let i = exL; i < exR; i++) {
    const p = mt.getCursor(i, 0).pos(); // {peer, counter}
    const agentAuthored = String(p.peer) === agentPeer;
    const insideLive = i >= liveL && i < liveR;
    if (agentAuthored || insideLive) version += s[i];
  }
  const live = human.getText("mdx").toString().slice(pos(human, liveStart), pos(human, liveEnd));
  // simulate flip in the human doc: replace live interval with version
  const flip = human.fork();
  const ft = flip.getText("mdx");
  const L = pos(flip, liveStart),
    R = pos(flip, liveEnd);
  ft.delete(L, R - L);
  ft.insert(L, version);
  flip.commit();
  const actual = human.fork();
  const result = proposeBranch(
    actual,
    base,
    agent,
    [{ from, to }],
    [{ from, to: from + "Fourth".length, insert: "Agent" }],
    { kind: "agent", name: "regression" },
  );
  flipAlternative(actual, result.alternatives[0], 1);
  assert(actual.getText("mdx").toString()).toBe(ft.toString());
  return {
    kind,
    peers: `${humanPeer}/${agentPeer}`,
    live,
    version,
    flipped: ft.toString().split("\n\n")[3],
  };
};
const expect = {
  edges: "LEFT Agent sentence. Another sentence. RIGHT",
  "inside-edit": "Agent sentence. Human Another sentence.",
  "first-sentence-deletion": "AgentAnother sentence.",
  "paragraph-2": "Agent sentence. Another sentence.",
};
it("filters proposal authorship and flips without edge duplication under both peer orders", () => {
  let ok = true;
  for (const kind of Object.keys(expect))
    for (const [h, a] of [
      ["2", "3"],
      ["3", "2"],
    ]) {
      const r = run(kind, h, a);
      const pass = r.flipped === expect[kind];
      ok &&= pass;
      console.log(
        pass ? "PASS" : "FAIL",
        kind,
        r.peers,
        JSON.stringify({ version: r.version, flipped: r.flipped }),
      );
    }
  assert(ok).toBe(true);
});
