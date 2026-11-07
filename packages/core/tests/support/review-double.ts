import { createServer } from "node:http";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

export type Brief = {
  base: string;
  text: string;
  reader?: string;
  medium?: string;
  budget?: number;
  ruleset: { rules: Record<string, unknown>; custom: unknown[] };
  questions: { id: string; text: string }[];
};
type Reply = { status?: number; content: string };
/** Answers every question plainly unless a test supplies another reply. */
export const plain = (brief: Brief): Reply => ({
  content: JSON.stringify({
    answers: brief.questions.map((q) => ({ question: q.id, text: `Answer to ${q.text}` })),
  }),
});
/** An OpenAI-compatible HTTP double that records each request and can hold its response. */
export async function reviewDouble(home: string) {
  let respond: (brief: Brief) => Reply = plain;
  let gate: Promise<void> = Promise.resolve();
  let arrived = () => {};
  let finished = () => {};
  const bodies: { messages: { role: string; content: string }[] }[] = [];
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const parsed = JSON.parse(body);
    bodies.push(parsed);
    arrived();
    await gate;
    const reply = respond(JSON.parse(parsed.messages[1].content));
    res.writeHead(reply.status ?? 200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { content: reply.content } }] }));
    finished();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address();
  if (!address || typeof address === "string") throw Error("No port");
  const config = {
    endpoint: `http://127.0.0.1:${address.port}/v1/chat/completions`,
    model: "double",
    timeoutMs: 2000,
  };
  await writeFile(join(home, "config.json"), JSON.stringify({ rewrite: config }));
  return {
    config,
    bodies,
    calls: () => bodies.length,
    briefs: () => bodies.map((b) => JSON.parse(b.messages[1].content) as Brief),
    reply(next: (brief: Brief) => Reply) {
      respond = next;
    },
    /** Holds responses until release; `arrived` resolves when the provider is called. */
    hold() {
      let release = () => {};
      gate = new Promise<void>((r) => {
        release = r;
      });
      const arrival = new Promise<void>((r) => {
        arrived = r;
      });
      const done = new Promise<void>((r) => {
        finished = r;
      });
      return {
        arrived: arrival,
        done,
        release: () => {
          release();
          gate = Promise.resolve();
        },
      };
    },
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
