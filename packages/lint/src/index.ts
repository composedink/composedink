import { LocalLinter, SuggestionKind } from "harper.js";
import { binaryInlined } from "harper.js/binaryInlined";
import { validateProps, type PropsSchema } from "@composedink/blocks";
import { paragraphs } from "./prose.ts";
import { style } from "./rules.ts";
export interface Diagnostic {
  readonly from: number;
  readonly to: number;
  readonly code: string;
  readonly message: string;
  readonly replacement?: string;
}
export interface LintSnapshot {
  readonly base: string;
  readonly text: string;
  readonly blocks?: readonly {
    readonly from: number;
    readonly to: number;
    readonly props: unknown;
    readonly schema: PropsSchema;
  }[];
}
export interface LintResult {
  readonly base: string;
  readonly diagnostics: Diagnostic[];
  readonly changedParagraphs: number;
  readonly elapsedMs: number;
}
export function createLinter() {
  const harper = new LocalLinter({ binary: binaryInlined });
  let cache = new Map<string, Diagnostic[]>();
  return {
    async lint(snapshot: LintSnapshot): Promise<LintResult> {
      const start = performance.now();
      const next = new Map<string, Diagnostic[]>();
      const diagnostics: Diagnostic[] = [];
      let changedParagraphs = 0;
      for (const p of paragraphs(snapshot.text)) {
        const key = p.source + "\u0000" + p.prose;
        let local = cache.get(key) ?? next.get(key);
        if (!local) {
          changedParagraphs++;
          local = style(p);
          for (const lint of await harper.lint(p.prose, { language: "plaintext" })) {
            const span = lint.span();
            const suggestions = lint.suggestions();
            const suggestion = suggestions[0];
            const replacement = suggestion
              ? (suggestion.kind() === SuggestionKind.InsertAfter
                  ? p.prose.slice(span.start, span.end)
                  : "") + suggestion.get_replacement_text()
              : undefined;
            if (p.source.slice(span.start, span.end) === p.prose.slice(span.start, span.end))
              local.push({
                from: span.start,
                to: span.end,
                code: "harper:" + lint.lint_kind(),
                message: lint.message(),
                ...(replacement === undefined ? {} : { replacement }),
              });
            suggestions.forEach((s) => s.free());
            span.free();
            lint.free();
          }
        }
        next.set(key, local);
        diagnostics.push(...local.map((d) => ({ ...d, from: d.from + p.from, to: d.to + p.from })));
      }
      cache = next;
      for (const block of snapshot.blocks ?? [])
        for (const issue of validateProps(block.schema, block.props))
          diagnostics.push({
            from: block.from,
            to: block.to,
            code: "block:props",
            message: issue.path + ": " + issue.message,
          });
      diagnostics.sort((a, b) => a.from - b.from || a.to - b.to || a.code.localeCompare(b.code));
      return {
        base: snapshot.base,
        diagnostics,
        changedParagraphs,
        elapsedMs: performance.now() - start,
      };
    },
  };
}
