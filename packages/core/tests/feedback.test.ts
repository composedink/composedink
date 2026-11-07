import { expect, it } from "vite-plus/test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { authority, openStore, bind } from "../src/node.ts";
import { replaceText } from "../src/model/text.ts";
import { QUESTIONS } from "../src/kinds/builtins.ts";

const human = { kind: "human" } as const;
async function fixture() {
  const home = await mkdtemp(join(tmpdir(), "feedback-"));
  const a = await authority(await openStore(home));
  const run = bind(a);
  await run("doc.create", { slug: "p" });
  await a.change("p", (d) => replaceText(d, "Alpha beta gamma.\n\nSecond paragraph here."));
  return { home, a, run, close: () => rm(home, { recursive: true, force: true }) };
}

it("thread ops attribute messages from context and return the documented shapes", async () => {
  const f = await fixture();
  try {
    const base = f.a.read("p").base;
    const open = (await f.run(
      "thread.open",
      { id: "p", base, quote: "beta", text: "Why beta?", request: "open-1" },
      undefined,
      undefined,
      human,
    )) as { thread: string };
    expect(open).toEqual({ thread: expect.any(String) });
    // A lost acknowledgement replays the receipt rather than opening a second thread.
    expect(
      await f.run("thread.open", {
        id: "p",
        base,
        quote: "beta",
        text: "Why beta?",
        request: "open-1",
      }),
    ).toEqual(open);
    await expect(
      f.run("thread.open", { id: "p", base, quote: "gamma", text: "x", request: "open-1" }),
    ).rejects.toThrow("RequestConflict");
    expect(await f.run("thread.reply", { id: "p", thread: open.thread, text: "Because." })).toEqual(
      { thread: open.thread, state: "open" },
    );
    expect(await f.run("thread.resolve", { id: "p", thread: open.thread })).toEqual({
      thread: open.thread,
      state: "resolved",
    });
    expect(await f.run("thread.list", { id: "p", state: "open" })).toEqual([]);
    expect(await f.run("thread.list", { id: "p" })).toEqual([
      {
        thread: open.thread,
        from: 6,
        to: 10,
        state: "resolved",
        messages: [
          { by: human, at: expect.any(Number), text: "Why beta?" },
          { by: { kind: "agent", name: "cli" }, at: expect.any(Number), text: "Because." },
        ],
      },
    ]);
    await expect(
      f.run("thread.open", { id: "p", base, quote: "beta", text: "" }),
    ).rejects.toThrow();
    await expect(
      f.run("thread.open", { id: "p", base, quote: "beta", text: "q", question: "nope.q1" }),
    ).rejects.toThrow("UnknownQuestion");
    expect(f.a.read("p").text).toBe("Alpha beta gamma.\n\nSecond paragraph here.");
  } finally {
    await f.close();
  }
});

it("feedback.request persists questions from the kind or explicit text with stable ids", async () => {
  const f = await fixture();
  try {
    const seeded = (await f.run(
      "feedback.request",
      { id: "p", to: ["model", "model"] },
      undefined,
      undefined,
      human,
    )) as {
      request: string;
      state: unknown;
    };
    expect(seeded).toEqual({ request: expect.any(String), state: { status: "pending" } });
    const answers = (await f.run("feedback.answers", { id: "p", request: seeded.request })) as {
      questions: { id: string; text: string }[];
    };
    expect(answers).toEqual({
      request: seeded.request,
      questions: QUESTIONS.map((text, i) => ({ id: `${seeded.request}.q${i + 1}`, text })),
      state: { status: "pending" },
    });
    const stored = f.a.get("p").getMap("requests").toJSON()[seeded.request];
    expect(stored).toMatchObject({ by: human, to: ["model"], at: expect.any(Number) });
    const explicit = (await f.run("feedback.request", {
      id: "p",
      to: ["model"],
      questions: ["Is the opening clear?"],
      request: "ask-1",
    })) as { request: string };
    expect(explicit.request).not.toBe("ask-1");
    expect(
      await f.run("feedback.request", {
        id: "p",
        to: ["model"],
        questions: ["Is the opening clear?"],
        request: "ask-1",
      }),
    ).toEqual(explicit);
    const thread = (await f.run("thread.open", {
      id: "p",
      base: f.a.read("p").base,
      quote: "Alpha",
      text: "about the opening",
      question: `${explicit.request}.q1`,
    })) as { thread: string };
    expect(await f.run("thread.list", { id: "p" })).toEqual([
      expect.objectContaining({ thread: thread.thread, question: `${explicit.request}.q1` }),
    ]);
    // The kind's own (user-edited) question list is the default.
    const kind = (await f.run("kind.read", { kind: "post" })) as {
      base: string;
      files: Record<string, string>;
    };
    const config = JSON.parse(kind.files["kind.json"]);
    await f.run("kind.write", {
      kind: "post",
      file: "kind.json",
      base: kind.base,
      text: JSON.stringify({ ...config, questions: ["Only this?"] }),
    });
    const edited = (await f.run("feedback.request", { id: "p", to: ["model"] })) as {
      request: string;
    };
    expect(
      (
        (await f.run("feedback.answers", { id: "p", request: edited.request })) as {
          questions: unknown;
        }
      ).questions,
    ).toEqual([{ id: `${edited.request}.q1`, text: "Only this?" }]);
    const reloaded = bind(await authority(await openStore(f.home)));
    expect(await reloaded("feedback.answers", { id: "p", request: seeded.request })).toEqual(
      answers,
    );
  } finally {
    await f.close();
  }
});

it("rejects empty questions, no recipients and link recipients without a session", async () => {
  const f = await fixture();
  try {
    await expect(f.run("feedback.request", { id: "p", to: [] })).rejects.toThrow();
    await expect(
      f.run("feedback.request", { id: "p", to: ["model"], questions: [] }),
    ).rejects.toThrow();
    await expect(
      f.run("feedback.request", { id: "p", to: ["model"], questions: [""] }),
    ).rejects.toThrow();
    await expect(f.run("feedback.request", { id: "p", to: ["model", "link:abc"] })).rejects.toThrow(
      "sign in to share",
    );
    await expect(f.run("feedback.request", { id: "p", to: ["somebody"] })).rejects.toThrow();
    await expect(f.run("feedback.answers", { id: "p", request: "missing" })).rejects.toThrow(
      "UnknownRequest",
    );
    expect(f.a.get("p").getMap("requests").size).toBe(0);
  } finally {
    await f.close();
  }
});

it("exported MDX carries no request data", async () => {
  const f = await fixture();
  try {
    await f.run("feedback.request", {
      id: "p",
      to: ["model"],
      questions: ["zebra-question-xyzzy?"],
    });
    await f.run("export", { view: "full", doc: "p", to: join(f.home, "content") });
    const out = join(f.home, "content/p");
    const written =
      (await readFile(join(out, "index.mdx"), "utf8")) +
      (await readFile(join(out, "composed.lock.json"), "utf8"));
    expect(written).not.toContain("zebra-question-xyzzy");
    for (const view of ["full", "clean"])
      expect(JSON.stringify(await f.run("doc.read", { doc: "p", view }))).not.toContain("zebra");
  } finally {
    await f.close();
  }
});
