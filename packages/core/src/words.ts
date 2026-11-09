import { analyze, blockSentences } from "@composedink/lint/prose";
/**
 * Prose words in an MDX source: the sum over the lint prose pass's sentences, so frontmatter (closed,
 * parseable or not), headings, code and JSX never count. The document list, the editor's status
 * bar and the budget rule all read this one number.
 */
export function bodyWords(source: string) {
  let words = 0;
  for (const paragraph of analyze(source).paragraphs)
    for (const sentences of blockSentences(paragraph)) for (const s of sentences) words += s.words;
  return words;
}
