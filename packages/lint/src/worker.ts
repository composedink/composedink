import { createLinter, type LintSnapshot, type LintResult } from "./index.ts";
export interface LintRequest {
  readonly id: number;
  readonly snapshot: LintSnapshot;
}
export type LintReply = { id: number; result: LintResult } | { id: number; error: string };
export function lintWorker(send: (reply: LintReply) => void) {
  const engine = createLinter();
  let queue = Promise.resolve();
  return (request: LintRequest) => {
    queue = queue.then(async () => {
      try {
        send({ id: request.id, result: await engine.lint(request.snapshot) });
      } catch (error) {
        send({ id: request.id, error: String(error) });
      }
    });
  };
}
