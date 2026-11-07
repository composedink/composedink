import { expect, it } from "vite-plus/test";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { authority, openStore, bind } from "../src/node.ts";
import { replaceText, retainMeta } from "../src/model/text.ts";
import { QUESTIONS } from "../src/kinds/builtins.ts";
import { reviewDouble, type Brief } from "./support/review-double.ts";

const human = { kind: "human" } as const;
const model = { kind: "agent", name: "model" } as const;
const SOURCE = "Alpha beta gamma.\n\nSecond paragraph here.\n\nThird one stays.";
async function fixture(text = SOURCE) {
  const home = await mkdtemp(join(tmpdir(), "feedback-"));
  const double = await reviewDouble(home);
  const a = await authority(await openStore(home));
  const run = bind(a);
  await run("doc.create", { slug: "p" });
  await a.change("p", (d) => replaceText(d, text));
  const type = async (edit: (text: string) => { at: number; remove?: number; insert?: string }) => {
    const branch = a.get("p").fork(),
      from = branch.version(),
      target = branch.getText("mdx");
    const { at, remove = 0, insert = "" } = edit(target.toString());
    if (remove) target.delete(at, remove);
    if (insert) target.insert(at, insert);
    branch.commit();
    await a.typing("p", branch.export({ mode: "update", from }));
  };
  const ask = (extra: Record<string, unknown> = {}, signal?: AbortSignal) =>
    run(
      "feedback.request",
      { id: "p", to: ["model"], questions: ["Is it clear?", "What to cut?"], ...extra },
      undefined,
      signal,
      human,
    ) as Promise<{ request: string; state: { status: string } & Record<string, unknown> }>;
  return {
    home,
    a,
    run,
    double,
    type,
    ask,
    threads: () => run("thread.list", { id: "p" }) as Promise<Record<string, unknown>[]>,
    stash: () => run("stash.list", { doc: "p" }) as Promise<unknown[]>,
    requests: () => Object.values(a.get("p").getMap("requests").toJSON()) as { state: unknown }[],
    close: async () => {
      await double.close();
      await rm(home, { recursive: true, force: true });
    },
  };
}
/** Answers each question; the first answer carries the given notes and rewrites. */
const answering =
  (notes: unknown[] = [], rewrites: unknown[] = []) =>
  (brief: Brief) => ({
    content: JSON.stringify({
      answers: brief.questions.map((q, i) => ({
        question: q.id,
        text: `Answer ${i + 1}`,
        notes: i === 0 ? notes : [],
        rewrites: i === 0 ? rewrites : [],
      })),
    }),
  });

it("thread ops attribute messages from context and return the documented shapes", async () => {
  const f = await fixture();
  try {
    const base = f.a.read("p").base;
    const input = { id: "p", base, quote: "beta", text: "Why beta?", request: "open-1" };
    const open = (await f.run("thread.open", input, undefined, undefined, human)) as {
      thread: string;
    };
    expect(open).toEqual({ thread: expect.any(String) });
    // A lost acknowledgement replays the receipt rather than opening a second thread.
    expect(await f.run("thread.open", input)).toEqual(open);
    await expect(f.run("thread.open", { ...input, quote: "gamma" })).rejects.toThrow(
      "RequestConflict",
    );
    expect(await f.run("thread.reply", { id: "p", thread: open.thread, text: "Because." })).toEqual(
      { thread: open.thread, state: "open" },
    );
    expect(await f.run("thread.resolve", { id: "p", thread: open.thread })).toEqual({
      thread: open.thread,
      state: "resolved",
    });
    expect(await f.run("thread.list", { id: "p", state: "open" })).toEqual([]);
    expect(await f.threads()).toEqual([
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
    expect(f.a.read("p").text).toBe(SOURCE);
  } finally {
    await f.close();
  }
});

it("defaults to the kind's four questions; explicit questions get stable ids", async () => {
  const f = await fixture();
  try {
    const seeded = (await f.run(
      "feedback.request",
      { id: "p", to: ["model", "model"] },
      undefined,
      undefined,
      human,
    )) as { request: string };
    const questions = QUESTIONS.map((text, i) => ({ id: `${seeded.request}.q${i + 1}`, text }));
    expect(f.double.briefs()[0].questions).toEqual(questions);
    expect(await f.run("feedback.answers", { id: "p", request: seeded.request })).toEqual({
      request: seeded.request,
      questions,
      state: {
        status: "answered",
        answers: QUESTIONS.map((text, i) => ({
          question: `${seeded.request}.q${i + 1}`,
          text: `Answer to ${text}`,
          threads: [],
          alternatives: [],
          detached: [],
        })),
      },
    });
    const stored = f.a.get("p").getMap("requests").toJSON()[seeded.request];
    expect(stored).toMatchObject({ by: human, to: ["model"], at: expect.any(Number) });
    const explicit = await f.ask({ questions: ["Is the opening clear?"] });
    const thread = (await f.run("thread.open", {
      id: "p",
      base: f.a.read("p").base,
      quote: "Alpha",
      text: "about the opening",
      question: `${explicit.request}.q1`,
    })) as { thread: string };
    expect(await f.threads()).toEqual([
      expect.objectContaining({ thread: thread.thread, question: `${explicit.request}.q1` }),
    ]);
    // The kind's own (user-edited) question list is the default.
    const kind = (await f.run("kind.read", { kind: "post" })) as {
      base: string;
      files: Record<string, string>;
    };
    await f.run("kind.write", {
      kind: "post",
      file: "kind.json",
      base: kind.base,
      text: JSON.stringify({ ...JSON.parse(kind.files["kind.json"]), questions: ["Only this?"] }),
    });
    const edited = (await f.run("feedback.request", { id: "p", to: ["model"] })) as {
      request: string;
    };
    expect(f.double.briefs().at(-1)?.questions).toEqual([
      { id: `${edited.request}.q1`, text: "Only this?" },
    ]);
  } finally {
    await f.close();
  }
});

it("rejects empty questions, no recipients and link recipients before any provider call", async () => {
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
      "SignInRequired: not signed in to a composed server; fix: composed login <server>",
    );
    await expect(f.run("feedback.request", { id: "p", to: ["somebody"] })).rejects.toThrow();
    await expect(f.run("feedback.answers", { id: "p", request: "missing" })).rejects.toThrow(
      "UnknownRequest",
    );
    expect(f.requests()).toEqual([]);
    expect(f.double.calls()).toBe(0);
  } finally {
    await f.close();
  }
});

it("captures the exact brief: clean text, meta-only reading values, effective rules with disabled entries", async () => {
  const f = await fixture();
  try {
    await f.run("doc.create", { slug: "h", kind: "hellotimber" });
    const kind = (await f.run("kind.read", { kind: "hellotimber" })) as { base: string };
    await f.run("kind.write", {
      kind: "hellotimber",
      file: "rules.json",
      base: kind.base,
      text: JSON.stringify({ extends: "post", rules: { filler: false }, custom: [] }),
    });
    await f.a.change("h", (d) => {
      replaceText(d, "---\ntitle: T\n---\n\nKeep this. Hidden aside. Visible end.\n");
      retainMeta(d, { reader: "hellotimber readers", medium: "phone", budget: 300 });
    });
    await f.run("ghost.set", {
      doc: "h",
      at: { base: f.a.read("h").base, quote: "Hidden aside. " },
      dim: true,
    });
    const base = f.a.read("h").base;
    const { rules, custom } = (await f.run("rules.effective", { id: "h" })) as {
      rules: Record<string, unknown>;
      custom: unknown[];
    };
    expect(rules.filler).toBe(false);
    const result = (await f.run("feedback.request", {
      id: "h",
      to: ["model"],
      questions: ["Q?"],
    })) as { request: string };
    expect(f.double.briefs()).toEqual([
      {
        base,
        text: "---\ntitle: T\n---\n\nKeep this. Visible end.\n",
        reader: "hellotimber readers",
        medium: "phone",
        budget: 300,
        ruleset: { rules, custom },
        questions: [{ id: `${result.request}.q1`, text: "Q?" }],
      },
    ]);
    const [body] = f.double.bodies;
    expect(Object.keys(body)).toEqual(["model", "messages"]);
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[0].content).toContain("never raise an issue a rule set to false covers");
    expect(body.messages[0].content).not.toContain("Hidden aside");
  } finally {
    await f.close();
  }
});

it("notes become question-linked model threads and rewrites become alternatives; prose unchanged", async () => {
  const f = await fixture();
  try {
    f.double.reply(
      answering(
        [
          { quote: "beta", text: "Name it." },
          { quote: "Third one", text: "Cut?" },
        ],
        [{ quote: "Second paragraph here.", versions: ["Two.", "The second."] }],
      ),
    );
    const result = await f.ask({ request: "ask-1" });
    expect(f.a.read("p").text).toBe(SOURCE);
    const answers = result.state.answers as {
      question: string;
      threads: string[];
      alternatives: string[];
      detached: string[];
      text: string;
    }[];
    expect(result.state.status).toBe("answered");
    expect(answers.map((a) => [a.question, a.text])).toEqual([
      [`${result.request}.q1`, "Answer 1"],
      [`${result.request}.q2`, "Answer 2"],
    ]);
    expect(answers[0].threads).toHaveLength(2);
    expect(answers[0].alternatives).toHaveLength(1);
    expect(answers[1]).toMatchObject({ threads: [], alternatives: [], detached: [] });
    const threads = await f.threads();
    expect(threads.map((t) => [t.thread, t.question, t.state])).toEqual(
      answers[0].threads.map((id) => [id, `${result.request}.q1`, "open"]),
    );
    expect(threads[0]).toMatchObject({
      from: 6,
      to: 10,
      messages: [{ by: model, text: "Name it." }],
    });
    const alt = f.a.read("p").alts[0];
    expect(alt).toMatchObject({ id: answers[0].alternatives[0], active: 0, count: 3 });
    expect(alt.versions?.slice(1).map((v) => [v.text, v.by])).toEqual([
      ["Two.", { kind: "model", model: "double" }],
      ["The second.", { kind: "model", model: "double" }],
    ]);
    expect(await f.run("feedback.answers", { id: "p", request: result.request })).toMatchObject({
      state: result.state,
    });
    // Acceptance stays explicit, through the existing alternative ops.
    await f.run("alt.flip", { doc: "p", alt: alt.id, to: 1 });
    expect(f.a.read("p").text).toBe(SOURCE.replace("Second paragraph here.", "Two."));
  } finally {
    await f.close();
  }
});

it("preserves concurrent typing; deleted targets give detached threads and stashed rewrites", async () => {
  const f = await fixture();
  try {
    f.double.reply(
      answering(
        [
          { quote: "beta", text: "Gone soon." },
          { quote: "Third", text: "Stays." },
        ],
        [{ quote: "Second paragraph here.", versions: ["Two."] }],
      ),
    );
    const held = f.double.hold();
    const pending = f.ask();
    await held.arrived;
    // The queue is free while the provider works: typing lands and the request is visible.
    expect(f.requests()).toMatchObject([{ state: { status: "pending" } }]);
    await f.type((t) => ({ at: t.length, insert: " Human." }));
    await f.type((t) => ({ at: t.indexOf("beta"), remove: "beta".length }));
    await f.type((t) => ({
      at: t.indexOf("Second paragraph here."),
      remove: "Second paragraph here.".length,
    }));
    held.release();
    const result = await pending;
    const expected = "Alpha  gamma.\n\n\n\nThird one stays. Human.";
    expect(f.a.read("p").text).toBe(expected);
    const [answer] = result.state.answers as {
      threads: string[];
      alternatives: string[];
      detached: string[];
    }[];
    expect(answer.alternatives).toEqual([]);
    expect(answer.detached).toHaveLength(1);
    // The existing proposal path keeps only model-authored characters once the target is gone.
    expect(await f.stash()).toEqual([
      expect.objectContaining({ id: answer.detached[0], text: "Two", reason: "detached" }),
    ]);
    const threads = await f.threads();
    expect(threads.map((t) => [t.thread, t.state])).toEqual([
      [answer.threads[1], "open"],
      [answer.threads[0], "detached"],
    ]);
  } finally {
    await f.close();
  }
});

it.each([
  ["malformed JSON", { content: "not json" }],
  ["no answers object", { content: "[]" }],
  ["a missing answer", { content: JSON.stringify({ answers: [] }) }],
  ["an unknown question", "unknown"],
  ["a duplicate answer", "duplicate"],
  ["an empty quote", "empty-quote"],
  ["empty versions", "empty-versions"],
  ["an absent quote", "absent"],
  ["an ambiguous quote", "ambiguous"],
  ["HTTP 401", { status: 401, content: "private" }],
  ["HTTP 500", { status: 500, content: "private" }],
] as const)("%s fails visibly with no partial result, persisted as failed", async (_, reply) => {
  const f = await fixture(SOURCE + "\n\nRepeat. Repeat.");
  try {
    f.double.reply((brief) => {
      if (typeof reply !== "string") return reply;
      const ids = brief.questions.map((q) => q.id);
      const valid = { quote: "beta", text: "A valid note lands only with the rest." };
      const answers = ids.map((question) => ({ question, text: "x", notes: [valid] }));
      if (reply === "unknown") answers[1].question = "other.q9";
      if (reply === "duplicate") answers[1].question = ids[0];
      const extra = {
        "empty-quote": { notes: [valid, { quote: "", text: "x" }] },
        "empty-versions": { rewrites: [{ quote: "gamma", versions: [] }] },
        absent: { notes: [valid, { quote: "not in the text", text: "x" }] },
        ambiguous: { rewrites: [{ quote: "Repeat.", versions: ["Once."] }] },
      }[reply as "absent"];
      return { content: JSON.stringify({ answers: [{ ...answers[0], ...extra }, answers[1]] }) };
    });
    const before = f.a.read("p");
    await expect(f.ask({ request: "bad" })).rejects.toThrow(/ProviderFailed:.*fix:/);
    expect(f.a.read("p").text).toBe(before.text);
    expect(f.a.read("p").alts).toEqual([]);
    expect(await f.threads()).toEqual([]);
    expect(await f.stash()).toEqual([]);
    const [request] = f.requests();
    expect(request.state).toEqual({
      status: "failed",
      message: expect.stringMatching(/^ProviderFailed:.*fix: /),
    });
    expect(JSON.stringify(request.state)).not.toContain("private");
    // The receipt replays the failed request; asking again is a new request that can succeed.
    expect(await f.ask({ request: "bad" })).toMatchObject({ state: { status: "failed" } });
    f.double.reply(answering());
    expect(await f.ask({ request: "again" })).toMatchObject({ state: { status: "answered" } });
  } finally {
    await f.close();
  }
});

it("timeouts and cancellation before commit fail; a committed answer wins a late cancellation", async () => {
  const f = await fixture();
  try {
    const slow = f.double.hold();
    const timedOut = f.ask({ request: "slow" });
    await slow.arrived;
    await expect(timedOut).rejects.toThrow("ProviderFailed");
    slow.release();
    await slow.done;
    expect(f.requests()[0].state).toMatchObject({ status: "failed" });
    const held = f.double.hold();
    const controller = new AbortController();
    const cancelled = f.ask({ request: "cancel" }, controller.signal);
    await held.arrived;
    controller.abort();
    await expect(cancelled).rejects.toThrow("cancelled");
    held.release();
    await held.done;
    expect(f.a.read("p").alts).toEqual([]);
    expect(f.requests()[1].state).toMatchObject({ status: "failed" });
    f.double.reply(answering([{ quote: "beta", text: "kept" }]));
    const late = new AbortController();
    const answered = await f.ask({ request: "late" }, late.signal);
    late.abort();
    expect(answered.state.status).toBe("answered");
    expect(await f.ask({ request: "late" }, late.signal)).toEqual(answered);
    expect(await f.threads()).toHaveLength(1);
  } finally {
    await f.close();
  }
}, 15000);

it("in-flight duplicates share one provider call; replay after completion and restart is stable", async () => {
  const f = await fixture();
  try {
    f.double.reply(answering([{ quote: "beta", text: "once" }]));
    const held = f.double.hold();
    const first = f.ask({ request: "dup" });
    await held.arrived;
    const second = f.ask({ request: "dup" });
    await expect(f.ask({ request: "dup", questions: ["Other?"] })).rejects.toThrow(
      "RequestConflict",
    );
    held.release();
    const result = await first;
    expect(await second).toEqual(result);
    expect(await f.ask({ request: "dup" })).toEqual(result);
    expect(f.double.calls()).toBe(1);
    expect(await f.threads()).toHaveLength(1);
    const restarted = bind(await authority(await openStore(f.home)));
    expect(
      await restarted("feedback.request", {
        id: "p",
        to: ["model"],
        questions: ["Is it clear?", "What to cut?"],
        request: "dup",
      }),
    ).toEqual(result);
    expect(f.double.calls()).toBe(1);
  } finally {
    await f.close();
  }
});

it("a pending request found after restart fails with a retry instruction, without a provider call", async () => {
  const f = await fixture();
  try {
    const held = f.double.hold();
    void f.ask({ request: "orphan" }).catch(() => {});
    await held.arrived;
    // A second authority on the same home models a restart while the first was mid-request.
    const restarted = await authority(await openStore(f.home));
    const [request] = Object.values(restarted.get("p").getMap("requests").toJSON());
    expect(request).toMatchObject({
      state: { status: "failed", message: expect.stringContaining("new feedback request") },
    });
    expect(
      await bind(restarted)("feedback.request", {
        id: "p",
        to: ["model"],
        questions: ["Is it clear?", "What to cut?"],
        request: "orphan",
      }),
    ).toMatchObject({ state: { status: "failed" } });
    expect(f.double.calls()).toBe(1);
    held.release();
  } finally {
    await f.close();
  }
});

for (const [phase, point] of [
  ["request", "transaction:committed"],
  ["request", "transaction:before-ack"],
  ["answer", "transaction:committed"],
  ["answer", "transaction:before-ack"],
] as const)
  it(`recovers after a kill at the ${phase} commit (${point})`, async () => {
    const f = await fixture();
    try {
      f.double.reply(answering([{ quote: "beta", text: "durable" }]));
      const child = spawn(
        "mise",
        [
          "exec",
          "--",
          "node",
          "--experimental-strip-types",
          new URL("./support/feedback-crash.ts", import.meta.url).pathname,
          f.home,
          phase,
          point,
        ],
        { stdio: "ignore" },
      );
      const signal = await new Promise((r) => child.once("exit", (_code, s) => r(s)));
      expect(signal).toBe("SIGKILL");
      const replay = bind(await authority(await openStore(f.home)));
      const result = (await replay("feedback.request", {
        id: "p",
        to: ["model"],
        questions: ["Q?"],
        request: "crash",
      })) as { state: { status: string } };
      const threads = (await replay("thread.list", { id: "p" })) as unknown[];
      if (phase === "request") {
        expect(result.state).toMatchObject({ status: "failed" });
        expect(threads).toEqual([]);
        expect(f.double.calls()).toBe(0);
      } else {
        expect(result.state).toMatchObject({ status: "answered" });
        expect(threads).toHaveLength(1);
        expect(f.double.calls()).toBe(1);
      }
      expect((await authority(await openStore(f.home))).read("p").text).toBe(SOURCE);
    } finally {
      await f.close();
    }
  }, 30000);

it("exported MDX and read projections carry no request data", async () => {
  const f = await fixture();
  try {
    await f.ask({ questions: ["zebra-question-xyzzy?"] });
    await f.run("export", { view: "full", doc: "p", to: join(f.home, "content") });
    const out = join(f.home, "content/p");
    const written =
      (await readFile(join(out, "index.mdx"), "utf8")) +
      (await readFile(join(out, "composed.lock.json"), "utf8"));
    expect(written).not.toContain("zebra-question-xyzzy");
    expect(written).not.toMatch(/requests|Answer to/);
    for (const view of ["full", "clean"])
      expect(JSON.stringify(await f.run("doc.read", { doc: "p", view }))).not.toMatch(
        /zebra|"requests"/,
      );
  } finally {
    await f.close();
  }
});
