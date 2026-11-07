import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import type { Sentence } from "@composedink/lint";
export const MAX_BARS = 120;
export interface Bucket {
  /** Indices into the sentence list, contiguous and in source order. */
  readonly members: readonly number[];
  /** Mean words per sentence across the members. */
  readonly height: number;
  /** The longest member (first on ties): what hover shows and focus targets. */
  readonly representative: number;
}
/**
 * One bar per sentence up to `max`; beyond that `max` contiguous buckets
 * [floor(i·N/max), floor((i+1)·N/max)), so every sentence belongs to exactly one bar.
 */
export function bucketSentences(
  sentences: readonly Pick<Sentence, "words">[],
  max = MAX_BARS,
): Bucket[] {
  const n = sentences.length;
  const count = Math.min(n, max);
  return Array.from({ length: count }, (_, i) => {
    const from = n <= max ? i : Math.floor((i * n) / max);
    const to = n <= max ? i + 1 : Math.floor(((i + 1) * n) / max);
    const members = Array.from({ length: to - from }, (_, k) => from + k);
    let representative = from;
    let total = 0;
    for (const m of members) {
      total += sentences[m].words;
      if (sentences[m].words > sentences[representative].words) representative = m;
    }
    return { members, height: total / members.length, representative };
  });
}
/** Sentence indices by words, longest first; source order breaks ties. */
export const byLength = (sentences: readonly Pick<Sentence, "words">[]) =>
  sentences.map((_, i) => i).sort((a, b) => sentences[b].words - sentences[a].words || a - b);
/**
 * Words per sentence across the document, drawn only from the accepted lint result. `current`
 * is false once the document has changed since that result; the list closes and jumps stop.
 */
export function SentenceSparkline({
  sentences,
  current,
  onJump,
}: {
  sentences: readonly Sentence[];
  current: boolean;
  onJump: (sentence: Sentence) => void;
}) {
  const buckets = useMemo(() => bucketSentences(sentences), [sentences]);
  const order = useMemo(() => byLength(sentences), [sentences]);
  const [active, setActive] = useState<number>();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!current) setOpen(false);
  }, [current]);
  useEffect(() => setActive(undefined), [buckets]);
  if (!sentences.length)
    return (
      <span className="sparkline-empty" data-testid="sparkline">
        No sentences
      </span>
    );
  const tallest = Math.max(...buckets.map((b) => b.height));
  const shown = active === undefined ? undefined : sentences[buckets[active].representative];
  const keys = (event: KeyboardEvent) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
    if (step) {
      event.preventDefault();
      setActive((a) => Math.max(0, Math.min(buckets.length - 1, (a ?? -step) + step)));
    } else if (event.key === "Escape") setOpen(false);
  };
  return (
    <span className="sparkline-wrap">
      <button
        type="button"
        className="sparkline"
        data-testid="sparkline"
        data-stale={!current}
        aria-label={`Sentence lengths: ${sentences.length} sentences`}
        aria-expanded={open}
        onClick={() => setOpen(current && !open)}
        onKeyDown={keys}
        onFocus={() => setActive((a) => a ?? 0)}
        onBlur={() => setActive(undefined)}
        onMouseLeave={() => setActive(undefined)}
      >
        {buckets.map((b, i) => (
          <span
            key={i}
            className="bar"
            data-active={active === i}
            data-members={b.members.join(" ")}
            data-height={b.height}
            style={{ height: `${Math.max(8, (b.height / tallest) * 100)}%` }}
            onMouseEnter={() => setActive(i)}
          />
        ))}
      </button>
      {shown && (
        <span className="sparkline-hover" data-testid="sparkline-hover">
          {shown.words} {shown.words === 1 ? "word" : "words"}: {shown.text}
        </span>
      )}
      {open && (
        <ol className="sentence-list" aria-label="Sentences by length">
          {order.map((i) => (
            <li key={i}>
              <button
                type="button"
                data-from={sentences[i].from}
                data-to={sentences[i].to}
                onClick={() => {
                  setOpen(false);
                  onJump(sentences[i]);
                }}
              >
                <span className="words">{sentences[i].words}</span> {sentences[i].text}
              </button>
            </li>
          ))}
        </ol>
      )}
    </span>
  );
}
