import { LoroDoc } from "loro-crdt";
import { it, expect } from "vite-plus/test";
it("regresses the resolved nine-case Loro extraction spike", () => {
  const original =
    "First paragraph.\n\nHuman paragraph.\n\nThird paragraph.\n\nFourth sentence. Another sentence.\n\nLast paragraph.";
  const quote = "Fourth sentence. Another sentence.";
  const from = original.indexOf(quote),
    to = from + quote.length;
  const out = [];
  for (const kind of [
    "paragraph-2",
    "full-deletion",
    "select-and-type",
    "first-sentence-deletion",
    "inside-edit",
    "edges",
    "agent-full-replacement",
    "agent-last-word",
    "agent-delete-all",
  ]) {
    const base = new LoroDoc();
    base.setPeerId("1");
    base.getText("mdx").insert(0, original);
    base.commit();
    // live anchors: base fork, unit's own first/last chars
    const liveStart = base.getText("mdx").getCursor(from, -1),
      liveEnd = base.getText("mdx").getCursor(to - 1, 1);
    const human = base.fork();
    human.setPeerId("2");
    const t = human.getText("mdx");
    if (kind === "paragraph-2")
      t.update(original.replace("Human paragraph.", "Human edited paragraph."));
    if (kind === "full-deletion") t.delete(from, quote.length);
    if (kind === "select-and-type") {
      t.delete(from, quote.length);
      t.insert(from, "Human replacement.");
    }
    if (kind === "first-sentence-deletion") t.delete(from, "Fourth sentence. ".length);
    if (kind === "inside-edit") t.insert(original.indexOf("Another"), "Human ");
    if (kind === "edges") {
      t.insert(to, " RIGHT");
      t.insert(from, "LEFT ");
    }
    human.commit();
    // agent edit on its own fork
    const agentUnit =
      kind === "agent-full-replacement"
        ? "Agent replacement!"
        : kind === "agent-last-word"
          ? "Fourth sentence. Another proposal!"
          : kind === "agent-delete-all"
            ? ""
            : "Agent sentence. Another sentence.";
    const agentSource = original.replace(quote, agentUnit);
    const agent = base.fork();
    agent.setPeerId("3");
    agent.getText("mdx").update(agentSource);
    agent.commit();
    // extraction cursors: in the agent fork AFTER its edit, on the post-edit unit's first/last chars.
    // Empty unit: anchor to the neighbours (char before, side Right; char after, side Left).
    const af = agentSource.indexOf(agentUnit === "" ? "\n\n\n\n" : agentUnit);
    let exStart, exEnd;
    if (agentUnit === "") {
      const sep = original.indexOf(quote);
      exStart = agent.getText("mdx").getCursor(sep - 1, 1);
      exEnd = agent.getText("mdx").getCursor(sep, -1);
    } else {
      exStart = agent.getText("mdx").getCursor(af, -1);
      exEnd = agent.getText("mdx").getCursor(af + agentUnit.length - 1, 1);
    }
    const merged = human.fork();
    merged.import(agent.export({ mode: "update", from: base.version() }));
    const range = (doc, s, e) => {
      const a = doc.getCursorPos(s),
        b = doc.getCursorPos(e);
      const L = a.offset + (a.side === 1 ? 1 : 0),
        R = b.offset + (b.side === 1 ? 1 : 0);
      return { from: L, to: R, text: doc.getText("mdx").toString().slice(L, R), empty: R <= L };
    };
    const live = range(human, liveStart, liveEnd);
    const proposal =
      agentUnit === "" ? range(merged, exStart, exEnd) : range(merged, exStart, exEnd);
    const detached = ["full-deletion", "select-and-type"].includes(kind);
    const expected = {
      "paragraph-2": "Agent sentence. Another sentence.",
      "inside-edit": "Agent sentence. Human Another sentence.",
      "first-sentence-deletion": "AgentAnother sentence.",
      "agent-full-replacement": "Agent replacement!",
      "agent-last-word": "Fourth sentence. Another proposal!",
      edges: "Agent sentence. Another sentence.",
      "agent-delete-all": "",
    }[kind];
    out.push({
      kind,
      liveEmpty: live.empty,
      liveText: live.text,
      proposal: proposal.text,
      expected,
      pass: live.empty === detached && (detached || proposal.text === expected),
    });
  }
  for (const r of out) expect(r.pass, JSON.stringify(r)).toBe(true);
});
