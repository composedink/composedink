import { requireSession } from "./session.ts";
import { activeLinks } from "./share.ts";
import { z } from "zod";
import type { Authority } from "./authority.ts";
import { documentSettings, resolveKind } from "./kinds.ts";
import { propose } from "./model/alternatives.ts";
import {
  createRequest,
  feedbackRequest,
  recipientSchema,
  settleRequest,
  type RequestState,
  type ReviewAnswer,
} from "./model/feedback.ts";
import { projection } from "./model/projection.ts";
import { head } from "./model/read.ts";
import { select, type Author } from "./model/selection.ts";
import { isPost } from "./model/text.ts";
import { openThread } from "./model/threads.ts";
import { loadRewriteConfig, reviewProvider, type ReviewBrief } from "./rewrite.ts";
import { payloadHash } from "./store/receipts.ts";

export const feedbackInput = z.object({
  id: z.string(),
  questions: z.array(z.string().min(1)).min(1).optional(),
  to: z.array(recipientSchema).min(1),
});
export type FeedbackInput = z.infer<typeof feedbackInput>;
type Result = { request: string; state: RequestState };
/** Thread attribution of model notes (design: `by: {kind:"agent", name:"model"}`). */
const reviewer = { kind: "agent", name: "model" } as const;
const retry = "ask again with a new feedback request";

/** Records the request (pending) in the document; runs inside the caller's receipt transaction. */
export async function createFeedback(a: Authority, i: FeedbackInput, by: Author): Promise<Result> {
  const doc = a.get(i.id);
  if (!isPost(doc)) throw Error(`InvalidInvariant: ${i.id} is not a post`);
  const links = i.to.filter((to) => to !== "model").map((to) => to.slice("link:".length));
  if (links.length) {
    // Link recipients need a server session and a link of this document that is still active.
    await requireSession(a.store.home);
    const active = await activeLinks(a.store.home, i.id);
    for (const link of links)
      if (!active.has(link)) throw Error(`UnknownLink: ${link}; fix: composed share list ${i.id}`);
  }
  const questions =
    i.questions ??
    (await resolveKind(a.store.home, String(doc.getMap("meta").get("kind")))).kind.config.questions;
  if (!questions.length)
    throw Error(
      "InvalidInvariant: kind has no feedback questions; fix: pass --question or add questions to kind.json",
    );
  const request = crypto.randomUUID();
  const created = await a.change(i.id, (d) =>
    createRequest(d, { by, questions, to: i.to }, request),
  );
  return { request, state: created.state };
}
/** The brief's document half, read under the queue: clean text and plan 13's effective rules. */
async function capture(a: Authority, id: string) {
  const doc = a.get(id);
  const { rules, custom, reader, medium, budget } = await documentSettings(a.store.home, doc);
  return {
    base: head(doc),
    text: projection(doc, "clean").text,
    reader,
    medium,
    budget,
    ruleset: { rules, custom },
  };
}
const current = (a: Authority, id: string, request: string): Result => ({
  request,
  state: feedbackRequest(a.get(id), request).state,
});
const inflight = new WeakMap<Authority, Map<string, { hash: string; work: Promise<Result> }>>();
/**
 * feedback.request: persist the request, capture the brief, ask the provider outside the queue,
 * then land every note and rewrite in one commit (or none, recording the failure). The caller's
 * receipt replays the request id; the final commit has its own identity derived from it.
 */
export async function requestFeedback(
  a: Authority,
  i: FeedbackInput,
  context: { by: Author; signal?: AbortSignal; request?: string; hash: string },
) {
  let pending = inflight.get(a);
  if (!pending) inflight.set(a, (pending = new Map()));
  const { request, hash } = context;
  if (request) {
    const same = pending.get(request);
    if (same) {
      if (same.hash !== hash) throw Error("RequestConflict: different feedback payload");
      return same.work;
    }
  }
  const work = review(a, i, context);
  if (request) pending.set(request, { hash, work });
  try {
    return await work;
  } finally {
    if (request) pending.delete(request);
  }
}
async function review(
  a: Authority,
  i: FeedbackInput,
  {
    by,
    signal,
    request,
    hash,
  }: { by: Author; signal?: AbortSignal; request?: string; hash: string },
): Promise<Result> {
  const started = await a.serialize(async () => {
    const prior = request ? a.store.journal.lookup(request, hash) : undefined;
    if (prior) return { replay: z.object({ request: z.string() }).parse(prior.result).request };
    const document = await capture(a, i.id);
    const created = await a.transaction(request, hash, () => createFeedback(a, i, by));
    const { request: id } = z.object({ request: z.string() }).parse(created);
    const brief: ReviewBrief = {
      ...document,
      questions: feedbackRequest(a.get(i.id), id).questions,
    };
    return { id, brief, replay: undefined };
  });
  if (started.replay !== undefined) return current(a, i.id, started.replay);
  const { id, brief } = started;
  // Only the model is asked here; link guests answer on the link page, so the request stays pending.
  if (!i.to.includes("model")) return current(a, i.id, id);
  const completion = `feedback:${id}:answer`;
  const completionHash = payloadHash("feedback.answer", { id: i.id, request: id });
  let outcome: { model: string; answers: Awaited<ReturnType<typeof reviewProvider>> } | Error;
  try {
    const config = await loadRewriteConfig(a.store.home);
    outcome = { model: config.model, answers: await reviewProvider(config, brief, signal) };
  } catch (error) {
    outcome = error instanceof Error ? error : Error(String(error));
  }
  return a.serialize(async () => {
    const prior = a.store.journal.lookup(completion, completionHash);
    if (prior) return prior.result as Result;
    if (!(outcome instanceof Error) && signal?.aborted)
      outcome = Error(`ProviderFailed: cancelled; fix: ${retry}`);
    if (!(outcome instanceof Error)) {
      const { model, answers } = outcome;
      try {
        return (await a.transaction(completion, completionHash, () =>
          a.change(i.id, (d) => {
            const at = (quote: string) => ({ base: brief.base, view: "clean" as const, quote });
            // Every quote resolves in the captured clean base before anything is written.
            for (const answer of answers.answers)
              for (const { quote } of [...answer.notes, ...answer.rewrites])
                try {
                  select(d, at(quote));
                } catch (error) {
                  throw Error(
                    `ProviderFailed: the answer quotes "${quote}" (${String(error).replace(/^Error: /, "")}); fix: ${retry}`,
                  );
                }
            const order = brief.questions.map((q) => q.id);
            const landed: ReviewAnswer[] = [...answers.answers]
              .sort((x, y) => order.indexOf(x.question) - order.indexOf(y.question))
              .map((answer) => {
                const threads = answer.notes.map((note) =>
                  openThread(d, at(note.quote), {
                    text: note.text,
                    by: reviewer,
                    question: answer.question,
                  }),
                );
                const alternatives: string[] = [],
                  detached: string[] = [];
                for (const rewrite of answer.rewrites) {
                  const result = propose(d, at(rewrite.quote), rewrite.versions, {
                    kind: "model",
                    model,
                  });
                  if (result.alt) alternatives.push(result.alt);
                  detached.push(...result.detached);
                }
                return {
                  question: answer.question,
                  text: answer.text,
                  threads,
                  alternatives,
                  detached,
                };
              });
            const state = { status: "answered" as const, answers: landed };
            settleRequest(d, id, state);
            return { request: id, state };
          }),
        )) as Result;
      } catch (error) {
        outcome = error instanceof Error ? error : Error(String(error));
      }
    }
    const failure = outcome;
    await a.transaction(completion, completionHash, () =>
      a.change(i.id, (d) => {
        const message = failure.message.startsWith("ProviderFailed:")
          ? failure.message
          : `ProviderFailed: ${failure.message}; fix: ${retry}`;
        settleRequest(d, id, { status: "failed", message });
        return { request: id, state: { status: "failed", message } };
      }),
    );
    throw failure;
  });
}
