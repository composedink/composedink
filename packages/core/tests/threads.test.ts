import { expect, it } from "vite-plus/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LoroDoc } from "loro-crdt";
import { authority, openStore, bind, undoSession } from "../src/node.ts";
import { replaceText } from "../src/model/text.ts";
import { openThread, replyThread, resolveThread, threadViews } from "../src/model/threads.ts";
import { KEYS } from "../src/model/keys.ts";
import { project } from "../src/model/projection.ts";

const human = { kind: "human" } as const;
const agent = { kind: "agent", name: "cli" } as const;
async function fixture(text = "Alpha beta gamma.\n\nSecond paragraph here.") {
  const home = await mkdtemp(join(tmpdir(), "threads-"));
  const a = await authority(await openStore(home));
  await bind(a)("doc.create", { slug: "p" });
  await a.change("p", (d) => replaceText(d, text));
  /** Imports an editor replica's typing unchanged, as the socket does. */
  const type = async (edit: (text: string) => { at: number; remove?: number; insert?: string }) => {
    const branch = a.get("p").fork(),
      from = branch.version(),
      target = branch.getText(KEYS.mdx);
    const { at, remove = 0, insert = "" } = edit(target.toString());
    if (remove) target.delete(at, remove);
    if (insert) target.insert(at, insert);
    branch.commit();
    await a.typing("p", branch.export({ mode: "update", from }));
  };
  const open = (quote: string, base = a.read("p").base, by: object = human) =>
    a.change("p", (d) => openThread(d, { base, quote }, { text: `on ${quote}`, by } as never));
  const list = () => threadViews(a.get("p"));
  const quoted = (from: number | null, to: number | null) =>
    from === null || to === null ? null : a.read("p").text.slice(from, to);
  return {
    home,
    a,
    type,
    open,
    list,
    quoted,
    close: () => rm(home, { recursive: true, force: true }),
  };
}

it("opens, replies and resolves without deleting; reply order is durable across reload", async () => {
  const f = await fixture();
  try {
    const thread = await f.open("beta");
    expect(f.list()).toEqual([
      {
        thread,
        from: 6,
        to: 10,
        state: "open",
        messages: [{ by: human, at: expect.any(Number), text: "on beta" }],
      },
    ]);
    expect(await f.a.change("p", (d) => replyThread(d, thread, { by: agent, text: "two" }))).toBe(
      "open",
    );
    expect(await f.a.change("p", (d) => replyThread(d, thread, { by: human, text: "three" }))).toBe(
      "open",
    );
    expect(await f.a.change("p", (d) => resolveThread(d, thread))).toBe("resolved");
    expect(await f.a.change("p", (d) => replyThread(d, thread, { by: human, text: "four" }))).toBe(
      "resolved",
    );
    const reloaded = await authority(await openStore(f.home));
    const [view] = threadViews(reloaded.get("p"));
    expect(view).toMatchObject({ thread, from: 6, to: 10, state: "resolved" });
    expect(view.messages.map((m) => [m.by, m.text])).toEqual([
      [human, "on beta"],
      [agent, "two"],
      [human, "three"],
      [human, "four"],
    ]);
  } finally {
    await f.close();
  }
});

it("rejects duplicate, missing and empty quotes; unknown threads fail", async () => {
  const f = await fixture("Same word. Same word.");
  try {
    await expect(f.open("Same word.")).rejects.toThrow("AmbiguousQuote");
    await expect(f.open("absent")).rejects.toThrow("QuoteNotFound");
    await expect(f.open("")).rejects.toThrow();
    await expect(f.a.change("p", (d) => resolveThread(d, "missing"))).rejects.toThrow(
      "UnknownThread",
    );
    expect(f.list()).toEqual([]);
  } finally {
    await f.close();
  }
});

it("opens a detached thread for a missing quote only with detachedIfMissing", async () => {
  const f = await fixture();
  const guest = { kind: "guest", name: "Ada", linkId: "link-1" } as const;
  try {
    const base = f.a.read("p").base;
    const first = { text: "Where did this go?", by: guest, question: undefined };
    await expect(
      f.a.change("p", (d) => openThread(d, { base, quote: "vanished" }, first)),
    ).rejects.toThrow("QuoteNotFound");
    const thread = await f.a.change("p", (d) =>
      openThread(d, { base, quote: "vanished" }, first, "t-missing", { detachedIfMissing: true }),
    );
    expect(thread).toBe("t-missing");
    expect(f.list()).toEqual([
      {
        thread: "t-missing",
        from: null,
        to: null,
        state: "detached",
        messages: [{ by: guest, at: expect.any(Number), text: "Where did this go?" }],
      },
    ]);
    const stored = f.a.get("p").getMap(KEYS.threads).toJSON()["t-missing"];
    expect(stored).toMatchObject({ start: [], end: [], state: "detached" });
    // Other selection errors are unchanged by the option.
    await f.type(() => ({ at: 0, insert: "beta " }));
    await expect(
      f.a.change("p", (d) =>
        openThread(d, { base: f.a.read("p").base, quote: "beta" }, first, "t2", {
          detachedIfMissing: true,
        }),
      ),
    ).rejects.toThrow("AmbiguousQuote");
  } finally {
    await f.close();
  }
});

it("anchors a stale-base quote in current history and creates detached when it is gone", async () => {
  const f = await fixture();
  try {
    const stale = f.a.read("p").base;
    await f.type(() => ({ at: 0, insert: "Intro. " }));
    const thread = await f.open("beta", stale);
    const [view] = f.list();
    expect(view.thread).toBe(thread);
    expect(f.quoted(view.from, view.to)).toBe("beta");
    expect(view.from).toBe(13);
    await f.type((t) => ({ at: t.indexOf("gamma"), remove: "gamma".length }));
    const gone = await f.open("gamma", stale);
    expect(f.list().find((t) => t.thread === gone)).toMatchObject({
      from: null,
      to: null,
      state: "detached",
    });
  } finally {
    await f.close();
  }
});

it("keeps edge typing outside, inside typing within, and concurrent typing merges", async () => {
  const f = await fixture();
  try {
    const before = f.a.read("p").base;
    const branch = f.a.get("p").fork(),
      from = branch.version();
    // A replica types inside the range before it learns about the thread.
    const target = branch.getText(KEYS.mdx);
    target.insert(8, "-x-");
    branch.commit();
    await f.open("beta", before);
    await f.a.typing("p", branch.export({ mode: "update", from }));
    expect(f.quoted(f.list()[0].from, f.list()[0].to)).toBe("be-x-ta");
    await f.type((t) => ({ at: t.indexOf("be-x-ta"), insert: "LEFT " }));
    await f.type((t) => ({ at: t.indexOf("be-x-ta") + "be-x-ta".length, insert: " RIGHT" }));
    expect(f.a.read("p").text).toContain("LEFT be-x-ta RIGHT");
    expect(f.quoted(f.list()[0].from, f.list()[0].to)).toBe("be-x-ta");
  } finally {
    await f.close();
  }
});

it("partial deletion stays anchored; complete deletion detaches permanently with messages", async () => {
  const f = await fixture();
  try {
    const thread = await f.open("beta gamma");
    await f.type((t) => ({ at: t.indexOf("beta"), remove: "beta ".length }));
    expect(f.list()[0]).toMatchObject({ state: "open" });
    expect(f.quoted(f.list()[0].from, f.list()[0].to)).toBe("gamma");
    await f.a.change("p", (d) => resolveThread(d, thread));
    await f.type((t) => ({ at: t.indexOf("gamma"), remove: "gamma".length }));
    expect(f.list()[0]).toMatchObject({ thread, from: null, to: null, state: "detached" });
    // Text typed where the anchor was never re-attaches it.
    await f.type((t) => ({ at: t.indexOf("."), insert: "gamma" }));
    expect(f.list()[0]).toMatchObject({ state: "detached", messages: [{ text: "on beta gamma" }] });
    expect(await f.a.change("p", (d) => replyThread(d, thread, { by: human, text: "still" }))).toBe(
      "detached",
    );
    await expect(f.a.change("p", (d) => resolveThread(d, thread))).rejects.toThrow("detached");
    const reloaded = await authority(await openStore(f.home));
    expect(threadViews(reloaded.get("p"))[0]).toMatchObject({ state: "detached" });
    expect(threadViews(reloaded.get("p"))[0].messages).toHaveLength(2);
  } finally {
    await f.close();
  }
});

it("operations that delete text (cut, flip) detach and undo restores text but not the anchor", async () => {
  const f = await fixture();
  try {
    await f.open("gamma");
    const run = bind(f.a);
    await run("stash.add", { doc: "p", at: { base: f.a.read("p").base, quote: "gamma" } }, "s");
    expect(f.list()[0].state).toBe("detached");
    await undoSession(f.a, "s");
    expect(f.a.read("p").text).toContain("gamma");
    expect(f.list()[0].state).toBe("detached");
    const flipped = await f.open("Second paragraph here.");
    const { alt } = (await run("alt.propose", {
      doc: "p",
      at: { base: f.a.read("p").base, quote: "Second paragraph here." },
      versions: ["Another paragraph."],
      by: agent,
    })) as { alt: string };
    expect(f.list().find((t) => t.thread === flipped)?.state).toBe("open");
    await run("alt.flip", { doc: "p", alt, to: "next" });
    expect(f.a.read("p").text).toContain("Another paragraph.");
    expect(f.list().find((t) => t.thread === flipped)?.state).toBe("detached");
  } finally {
    await f.close();
  }
});

it("concurrent replies from two replicas merge in the MovableList", async () => {
  const f = await fixture();
  try {
    const thread = await f.open("beta");
    const one = new LoroDoc(),
      two = new LoroDoc();
    one.import(f.a.get("p").export({ mode: "snapshot" }));
    two.import(f.a.get("p").export({ mode: "snapshot" }));
    const from = one.version();
    replyThread(one, thread, { by: human, text: "from one" });
    replyThread(two, thread, {
      by: { kind: "guest", name: "Ana", linkId: "l1" },
      text: "from two",
    });
    two.import(one.export({ mode: "update", from }));
    one.import(two.export({ mode: "update", from }));
    expect(threadViews(one)).toEqual(threadViews(two));
    expect(
      threadViews(one)[0]
        .messages.map((m) => m.text)
        .sort(),
    ).toEqual(["from one", "from two", "on beta"]);
  } finally {
    await f.close();
  }
});

it("threads stay out of clean and full read projections", async () => {
  const f = await fixture("---\ntitle: T\n---\n\nAlpha beta gamma.\n");
  try {
    await f.open("beta");
    await f.a.change("p", (d) =>
      replyThread(d, threadViews(d)[0].thread, { by: human, text: "zebra-comment-xyzzy" }),
    );
    const run = bind(f.a);
    for (const view of ["full", "clean"] as const) {
      const read = JSON.stringify(await run("doc.read", { doc: "p", view }));
      expect(read).not.toContain("zebra-comment-xyzzy");
      expect(read).not.toContain('"threads"');
      expect(project(f.a.get("p"), view).text).toBe("---\ntitle: T\n---\n\nAlpha beta gamma.\n");
    }
  } finally {
    await f.close();
  }
});

it("session undo reverses open, reply and resolve without touching concurrent prose", async () => {
  const f = await fixture();
  try {
    const step = <T>(run: () => Promise<T>) =>
      f.a.serialize(() =>
        f.a.sessionOperation("s", () => f.a.transaction(undefined, "thread-step", run)),
      );
    const thread = (await step(() => f.open("beta"))) as string;
    await step(() => f.a.change("p", (d) => replyThread(d, thread, { by: human, text: "reply" })));
    await step(() => f.a.change("p", (d) => resolveThread(d, thread)));
    await f.type((t) => ({ at: t.length, insert: " Concurrent." }));
    await undoSession(f.a, "s");
    expect(f.list()[0]).toMatchObject({ state: "open" });
    await undoSession(f.a, "s");
    expect(f.list()[0].messages.map((m) => m.text)).toEqual(["on beta"]);
    await undoSession(f.a, "s");
    expect(f.list()).toEqual([]);
    expect(f.a.read("p").text).toBe("Alpha beta gamma.\n\nSecond paragraph here. Concurrent.");
  } finally {
    await f.close();
  }
});
