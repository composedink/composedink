import type { LoroDoc } from "loro-crdt";
import { z } from "zod";
import { KEYS } from "./keys.ts";
import { threadAuthorSchema, type ThreadAuthor } from "./threads.ts";

/** Recipients: the model now; `link:<LinkId>` is reserved for P2 shared preview links. */
export const recipientSchema = z.union([z.literal("model"), z.string().regex(/^link:.+/)]);
export const reviewAnswerSchema = z.object({
  question: z.string(),
  text: z.string(),
  threads: z.array(z.string()),
  alternatives: z.array(z.string()),
  /** Stash IDs of rewrites whose target was deleted before the answer landed. */
  detached: z.array(z.string()),
});
export type ReviewAnswer = z.infer<typeof reviewAnswerSchema>;
export const requestStateSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("pending") }),
  z.object({ status: z.literal("answered"), answers: z.array(reviewAnswerSchema) }),
  z.object({ status: z.literal("failed"), message: z.string() }),
]);
export type RequestState = z.infer<typeof requestStateSchema>;
const questionSchema = z.object({ id: z.string(), text: z.string() });
export type Question = z.infer<typeof questionSchema>;
const requestSchema = z.object({
  at: z.number(),
  by: threadAuthorSchema,
  questions: z.array(questionSchema).min(1),
  to: z.array(recipientSchema).min(1),
  state: requestStateSchema,
});
export type FeedbackRequest = z.infer<typeof requestSchema>;

export function feedbackRequest(doc: LoroDoc, id: string): FeedbackRequest {
  const value = doc.getMap(KEYS.requests).get(id);
  if (value === undefined) throw Error(`UnknownRequest: ${id}`);
  return requestSchema.parse(value);
}
export function feedbackRequests(doc: LoroDoc) {
  return doc
    .getMap(KEYS.requests)
    .entries()
    .map(([id, value]) => ({ id, ...requestSchema.parse(value) }));
}
/** Question IDs are derived from the request, so they are stable and unique in the document. */
export function createRequest(
  doc: LoroDoc,
  input: { by: ThreadAuthor; questions: string[]; to: z.infer<typeof recipientSchema>[] },
  id: string = crypto.randomUUID(),
) {
  if (doc.getMap(KEYS.requests).get(id) !== undefined)
    throw Error(`InvalidInvariant: duplicate request ${id}`);
  const request = requestSchema.parse({
    at: Date.now(),
    by: input.by,
    questions: input.questions.map((text, i) => ({ id: `${id}.q${i + 1}`, text })),
    to: [...new Set(input.to)],
    state: { status: "pending" },
  });
  doc.getMap(KEYS.requests).set(id, request);
  doc.commit();
  return request;
}
/** Answers live in the request's state; there is no separate answers container. */
export function settleRequest(doc: LoroDoc, id: string, state: RequestState) {
  const request = feedbackRequest(doc, id);
  if (request.state.status !== "pending")
    throw Error(`InvalidInvariant: request ${id} is already ${request.state.status}`);
  doc.getMap(KEYS.requests).set(id, { ...request, state: requestStateSchema.parse(state) });
  doc.commit();
}
export function hasQuestion(doc: LoroDoc, question: string) {
  return feedbackRequests(doc).some((r) => r.questions.some((q) => q.id === question));
}
/** Pending requests nobody is answering (the authority restarted) fail with a retry instruction. */
export function failOrphaned(doc: LoroDoc) {
  const orphaned = feedbackRequests(doc).filter((r) => r.state.status === "pending");
  for (const r of orphaned)
    settleRequest(doc, r.id, {
      status: "failed",
      message:
        "The authority restarted before the model answered; ask again with a new feedback request.",
    });
  return orphaned.length;
}
