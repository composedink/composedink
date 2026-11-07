import { LocalLinter, SuggestionKind } from "harper.js";
import { binaryInlined } from "harper.js/binaryInlined";
import { validateProps, type PropsSchema } from "@composedink/blocks";
import { analyze, blockSentences, type Sentence } from "./prose.ts";
import { documentRules, paragraphRules } from "./rules.ts";
import {
  configIdentity,
  customDiagnostics,
  enabled,
  severity,
  type LintSettings,
  type Severity,
} from "./ruleset.ts";
export * from "./ruleset.ts";
export { countWords, splitSentences, type Sentence } from "./prose.ts";
export interface Diagnostic {
  readonly from: number;
  readonly to: number;
  readonly code: string;
  readonly severity: Severity;
  readonly message: string;
  readonly replacement?: string;
}
export interface LintSnapshot {
  readonly base: string;
  readonly text: string;
  /** The document's effective rules and reader; workers never read device configuration. */
  readonly settings: LintSettings;
  readonly blocks?: readonly {
    readonly from: number;
    readonly to: number;
    readonly props: unknown;
    readonly schema: PropsSchema;
  }[];
}
export interface LintResult {
  readonly base: string;
  /** configIdentity(snapshot.settings): consumers reject results for older configuration. */
  readonly config: string;
  readonly diagnostics: Diagnostic[];
  /** Every prose sentence in source order, from the same pass as the diagnostics. */
  readonly sentences: Sentence[];
  readonly changedParagraphs: number;
  readonly elapsedMs: number;
}
export function createLinter() {
  const harper = new LocalLinter({ binary: binaryInlined });
  // Per paragraph: diagnostics and each block's sentences, both relative to the paragraph.
  type Entry = { diagnostics: Diagnostic[]; sentences: Sentence[][] };
  let cache = new Map<string, Entry>();
  return {
    async lint(snapshot: LintSnapshot): Promise<LintResult> {
      const start = performance.now();
      const { settings } = snapshot;
      const config = configIdentity(settings);
      const harperOn = enabled(settings.rules, "harper");
      const next = new Map<string, Entry>();
      const diagnostics: Diagnostic[] = [];
      const sentences: Sentence[] = [];
      const shift = <T extends { from: number; to: number }>(v: T, by: number): T => ({
        ...v,
        from: v.from + by,
        to: v.to + by,
      });
      const prose = analyze(snapshot.text);
      let changedParagraphs = 0;
      for (const p of prose.paragraphs) {
        const shape = p.blocks.map((b) => `${b.kind}:${b.from}-${b.to}`).join(",");
        const key = [config, p.source, p.prose, shape].join("\u0000");
        let entry = cache.get(key) ?? next.get(key);
        if (!entry) {
          changedParagraphs++;
          const own = blockSentences(p);
          const local = [
            ...paragraphRules(p, own, settings),
            ...customDiagnostics(p, settings),
          ].filter((d) => enabled(settings.rules, d.code));
          entry = { diagnostics: local, sentences: own };
          for (const lint of harperOn
            ? await harper.lint(p.prose, { language: "plaintext" })
            : []) {
            const span = lint.span();
            const suggestions = lint.suggestions();
            const suggestion = suggestions[0];
            const replacement = suggestion
              ? (suggestion.kind() === SuggestionKind.InsertAfter
                  ? p.prose.slice(span.start, span.end)
                  : "") + suggestion.get_replacement_text()
              : undefined;
            const code = "harper:" + lint.lint_kind();
            if (
              enabled(settings.rules, code) &&
              p.source.slice(span.start, span.end) === p.prose.slice(span.start, span.end)
            )
              local.push({
                from: span.start,
                to: span.end,
                code,
                severity: severity(code),
                message: lint.message(),
                ...(replacement === undefined ? {} : { replacement }),
              });
            suggestions.forEach((s) => s.free());
            span.free();
            lint.free();
          }
        }
        next.set(key, entry);
        diagnostics.push(...entry.diagnostics.map((d) => shift(d, p.from)));
        for (const own of entry.sentences) sentences.push(...own.map((s) => shift(s, p.from)));
      }
      cache = next;
      const first = prose.paragraphs[0];
      const firstProse = first && first.from + first.prose.search(/\S/);
      diagnostics.push(
        ...documentRules(
          {
            sentences,
            sections: prose.sections,
            firstProse,
            firstProseLength:
              firstProse === undefined
                ? 0
                : snapshot.text.codePointAt(firstProse)! > 0xffff
                  ? 2
                  : 1,
          },
          settings,
        ).filter((d) => enabled(settings.rules, d.code)),
      );
      for (const block of snapshot.blocks ?? [])
        for (const issue of validateProps(block.schema, block.props))
          diagnostics.push({
            from: block.from,
            to: block.to,
            code: "block:props",
            severity: severity("block:props"),
            message: issue.path + ": " + issue.message,
          });
      diagnostics.sort((a, b) => a.from - b.from || a.to - b.to || a.code.localeCompare(b.code));
      return {
        base: snapshot.base,
        config,
        diagnostics,
        sentences,
        changedParagraphs,
        elapsedMs: performance.now() - start,
      };
    },
  };
}
