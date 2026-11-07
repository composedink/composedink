export type RequestId = string & { readonly __brand: "RequestId" };
export type Mutation<T> = T & { request?: RequestId };
export type DocRead = {
  doc: string;
  slug: string;
  base: string;
  view: "full" | "clean";
  text: string;
  dim: [number, number][];
  alts: { id: string; from: number; to: number; active: number; count: number }[];
  blocks: never[];
};
export type ThreadId = string & { readonly __brand: "ThreadId" };
export type QuestionId = string & { readonly __brand: "QuestionId" };
/**
 * A feedback request in the `requests` container. The design calls it RequestId, but that name
 * already brands the mutation receipt id above, which stays distinct from it.
 */
export type FeedbackRequestId = string & { readonly __brand: "FeedbackRequestId" };
export type LinkId = string;
export type ThreadAuthor =
  | { kind: "human" }
  | { kind: "agent"; name: string }
  | { kind: "model"; model: string }
  | { kind: "guest"; name: string; linkId: LinkId };
export type ThreadState = "open" | "resolved" | "detached";
export interface ThreadMessage {
  by: ThreadAuthor;
  at: number;
  text: string;
}
export interface ThreadView {
  thread: ThreadId;
  from: number | null;
  to: number | null;
  question?: QuestionId;
  state: ThreadState;
  messages: ThreadMessage[];
}
