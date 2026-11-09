import type { LoroDoc } from "loro-crdt";
import { z } from "zod";
import { KEYS } from "./keys.ts";
import { threadAuthorSchema, type ThreadAuthor } from "./threads.ts";

/** Recipients: the model, or a shared preview link `link:<LinkId>` whose guests answer. */
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
/** Addresses a pending request to one more recipient (a new shared link takes its questions). */
export function addRecipient(doc: LoroDoc, id: string, recipient: z.infer<typeof recipientSchema>) {
  const request = feedbackRequest(doc, id);
  if (request.state.status !== "pending")
    throw Error(`InvalidInvariant: request ${id} is already ${request.state.status}`);
  if (request.to.includes(recipient)) return request;
  const next = requestSchema.parse({ ...request, to: [...request.to, recipient] });
  doc.getMap(KEYS.requests).set(id, next);
  doc.commit();
  return next;
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
/** Pending request IDs; tolerant of malformed entries so an authority can always start. */
export const pendingRequests = (doc: LoroDoc) =>
  doc
    .getMap(KEYS.requests)
    .entries()
    .filter(([, value]) => requestSchema.safeParse(value).data?.state.status === "pending")
    .map(([id]) => id);
/**
 * Pending model requests: only the authority that asked the provider answers them, so after a
 * restart nobody is. Link-only requests stay pending; guests answer them on the link page.
 */
export const orphanedRequests = (doc: LoroDoc) =>
  pendingRequests(doc).filter((id) => feedbackRequest(doc, id).to.includes("model"));
/** Pending model requests nobody is answering (the authority restarted) fail with a retry instruction. */
export function failOrphaned(doc: LoroDoc) {
  const orphaned = orphanedRequests(doc).map((id) => ({ id }));
  for (const r of orphaned)
    settleRequest(doc, r.id, {
      status: "failed",
      message:
        "The authority restarted before the model answered; ask again with a new feedback request.",
    });
  return orphaned.length;
}
/** Removes a request nobody received, so it never reaches another device. */
export function removeRequest(doc: LoroDoc, id: string) {
  feedbackRequest(doc, id);
  doc.getMap(KEYS.requests).delete(id);
  doc.commit();
}
