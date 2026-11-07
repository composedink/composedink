import { expect, it } from "vite-plus/test";
import { LoroDoc, LoroMap, LoroMovableList } from "loro-crdt";
import { authorName, authorTag, readRequests, readThreads, stack } from "../src/editor/threads";

it("stacks colliding cards below each other in anchor order and leaves free cards in place", () => {
  const tops = stack(
    [
      { id: "a", anchor: 10, height: 50 },
      { id: "b", anchor: 20, height: 30 },
      { id: "c", anchor: 200, height: 10 },
      { id: "d", anchor: 205, height: 10 },
    ],
    8,
  );
  expect(Object.fromEntries(tops)).toEqual({ a: 10, b: 68, c: 200, d: 218 });
});

it("reads replicated threads with live local anchors, newest typing included", () => {
  const doc = new LoroDoc();
  const text = doc.getText("mdx");
  text.insert(0, "Alpha beta gamma.");
  doc.commit();
  const thread = doc.getMap("threads").setContainer("t1", new LoroMap());
  thread.set("start", Array.from(text.getCursor(6, -1)!.encode()));
  thread.set("end", Array.from(text.getCursor(9, 1)!.encode()));
  thread.set("state", "open");
  thread.setContainer("messages", new LoroMovableList()).push({
    by: { kind: "human" },
    at: 1,
    text: "Why?",
  });
  const gone = doc.getMap("threads").setContainer("t2", new LoroMap());
  gone.set("start", thread.get("start"));
  gone.set("end", thread.get("end"));
  gone.set("state", "detached");
  gone.setContainer("messages", new LoroMovableList());
  doc.getMap("requests").set("r1", {
    at: 5,
    by: { kind: "human" },
    to: ["model"],
    questions: [{ id: "r1.q1", text: "Clear?" }],
    state: { status: "pending" },
  });
  doc.commit();
  expect(readThreads(doc)).toEqual([
    {
      thread: "t1",
      from: 6,
      to: 10,
      state: "open",
      messages: [{ by: { kind: "human" }, at: 1, text: "Why?" }],
    },
    { thread: "t2", from: null, to: null, state: "detached", messages: [] },
  ]);
  text.insert(0, "Intro. ");
  doc.commit();
  expect(readThreads(doc)[0]).toMatchObject({ from: 13, to: 17 });
  // Deleted locally before the authority normalizes: shown detached, never relocated.
  text.delete(13, 4);
  doc.commit();
  expect(readThreads(doc).map((t) => [t.thread, t.state, t.from])).toEqual([
    ["t1", "detached", null],
    ["t2", "detached", null],
  ]);
  expect(readRequests(doc)).toEqual([
    {
      request: "r1",
      at: 5,
      by: { kind: "human" },
      to: ["model"],
      questions: [{ id: "r1.q1", text: "Clear?" }],
      state: { status: "pending" },
    },
  ]);
});

it("labels guests by name with their link, and nobody else", () => {
  const guest = { kind: "guest", name: "Ada", linkId: "3f9a2c71-aaaa" } as const;
  expect([authorName(guest), authorTag(guest)]).toEqual(["Ada", "guest · link 3f9a2c"]);
  expect(authorTag({ kind: "human" })).toBeUndefined();
  expect(authorTag({ kind: "agent", name: "model" })).toBeUndefined();
});
