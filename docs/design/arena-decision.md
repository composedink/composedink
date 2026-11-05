# Arena decision record — composed design package and MVP plan

## Artifact

The integrated design package `docs/design/composed.md` and the MVP plan under `docs/plans/`
(tracer bullet first, then the remaining MVP units), produced from two independent candidates.

## Candidates

| Candidate | Provider / model | Output | Status |
|---|---|---|---|
| A | Codex, gpt-6.1-sol (architecture role, L) | `docs/design/candidates/codex.md` (3,541 words) | complete |
| B | Claude, claude-opus-5-5 (architecture role, L) | `docs/design/candidates/claude.md` (~5,100 words) | complete |

Judge: Codex, gpt-6.1-sol in a fresh context (review role, L). No candidate was missing.

## Criteria and scores

Criteria C1–C8 as given to the candidates (consumer-first; model integrity; ownership and
boundaries; partial-edit safety; tracer bullet; verifiable units; grounding fidelity; minimum
complexity). Judge's scores:

| | C1 | C2 | C3 | C4 | C5 | C6 | C7 | C8 |
|---|---|---|---|---|---|---|---|---|
| A (Codex) | 4 | 4 | 4 | 4 | 3 | 3 | 4 | 3 |
| B (Claude) | 4 | 3 | 2 | 2 | 3 | 2 | 2 | 3 |

Boss verification of the facts the scores rest on (2026-11-05):
- hellotimber `website/src/writing/frontmatter.ts:60` throws on unknown frontmatter keys (B's
  reason for the sidecar lock) — confirmed.
- `loro-codemirror@0.3.3` `sync.ts:42` ignores `by: "local"` events and `sync.ts:65` returns on
  the first non-text diff (B's R2) — confirmed.
- `feed.ts` emits summaries, not bodies — confirmed; both candidates' RSS promises were narrowed.

## Selection

**Judge's recommendation:** A as base, with B's interfaces integrated.

**Boss decision:** B as the *textual* base (signatures, writer table, tracer evidence, unit
table, consumer snippets are more concrete and more usable), with A's *architecture* decisions
integrated where the judge showed B's model was unsafe. The resulting design is closer to A's
model with B's interfaces; the disagreement is about which text to edit, not about the model.

Why not A's text: its ownership and behaviour sections are prose with few checkable signatures;
its tracer and units bundle persistence, isolation and build machinery into unit 1; it stores
`active` alongside the null slot (duplicated fact); its binding reconciliation is unspecified.

## Integration

Integrated from A / the judge (reason):
1. Single local authority elected by a lock file — B's independent writers do not protect
   multi-container invariants (overlapping proposals, two compactors).
2. Binding protocol: import editor updates unchanged, then normalize in a follow-up commit —
   closes A's open reconciliation question without rewriting replicated history.
3. Agents cannot request direct overwrite — capability enforced at the MCP/CLI adapter.
4. Fallbacks evaluated at export by composed in an isolated worker, Markdown written into the
   lock — the host build executes nothing and needs no network; simpler than B's fetch + `data:`
   import in remark.
5. Request receipts for idempotent mutations — agent retries.
6. Detached proposals when an anchor range was deleted.
7. The export lock is the exact lock; `deps` is intent — fixes B's "deps is the lock".

Kept from B (judge agreed): derived active index; one operations registry generating CLI, MCP
and socket; frontmatter inside the `mdx` text with a sidecar lock; AST-extracted manifests;
quote-based selection; `remarkComposed` + `ComposedBlock`; the tracer evidence list; the unit
table and completion evidence; explicit `fix` commands in errors.

Rejected:
- A's separate `frontmatter: LoroText` — a second representation; the sidecar lock removes the
  need (judge agreed).
- A's per-block sandboxed iframes in the *published blog* for the MVP — **boss override of the
  judge.** Every MVP component is the author's own; the blog already runs its figures in-page;
  iframes cost layout, fonts, CSS and focus with no trust gain until untrusted components exist.
  The `usercontent` origin arrives with sharing (P3) for editor/preview/preview-link hosts.
  Recorded in `composed.md` as reversible.
- A's signed export tokens embedded in MDX comments — the sidecar lock carries the base.
- B's per-peer update files, `fs.watch` import and any-process compaction — see (1).
- B's host-build execution of `fallback.mjs` — see (4).
- B's caller-declared human authority for direct edits — see (3).
- Both candidates' RSS-body promises — hellotimber's feed is summary-only.

## Verification

Artifact verified: `docs/design/composed.md` and `docs/plans/README.md`, `01`–`11` as written by
the integration task (Codex gpt-6.1-sol), then revised.

Reviewers (interrogate, independent of the integration author): Codex gpt-6.1-sol and Claude
claude-opus-5-5, both review role at L, fresh contexts, same brief. Boss verified every
consequential finding against the text and, where it concerned hellotimber or Node, by running
it (2026-11-05): `vp fmt` rewrites MDX (`*emph*`→`_emph_`, `* `→`- `, JSX whitespace);
`.config/mise.toml` uses `_.path = ["node_modules/.bin"]`; the website is Nitro SSR, not
prerendered. The `vm` constructor-chain escape was executed by the Claude reviewer.

Verdict (all **act on**, applied in one revision pass; nothing classified consider/noted):
1. Lock election race (both reviewers) → `link()` create, rename-based stale recovery, lock
   `{pid, processStartTime, kind, ready}`, long-running commands never own inline, plan 01 ships
   no election.
2. Escapable fallback evaluator (Claude, executed) → `DONT_CONTEXTIFY`, Node ≥ 22.8,
   constructor-chain and async-loop tests.
3. Whole-file MDX hash vs hellotimber's formatter (Claude, executed) → per-instance validation
   only; file hash used only for outside-edit detection.
4. Outside-file import applied twice after crash (Codex) and mismatched pair misread as an
   outside edit (Claude) → reconciliation receipt keyed `(target, lock.base, file sha256)`;
   per-destination export history; import before snapshot.
5. "Range deleted" is not a cursor result (Codex) and flips revert concurrent edits (Claude,
   traced with loro-crdt 1.17.1) → proposals are merge results; empty-interval detachment;
   cursor sides Left/Right.
6. Plan 01 executability (both): evidence 6 needs the rebuild→re-export loop; preview server
   owner; export into a temp copy; studio serving `apps/web`; React for component builds; mise
   path; tsconfig include → all assigned to plan 01 / fixed.
7. No deployable workflow 7 (Claude) → plan 12 (deploy), plan 10 depends on it.
8. Preview locks would fail hellotimber production builds for drafts (Claude) → fallback-only
   with a warning; acceptance reworded to SSR.
9. Contract drift: `export` lacks `view`, `composed import` had no op, receipts in the
   replicated doc (both) → `view` added, `doc.import` added, receipts store-local.
10. Studio origin unspecified for remotes (Claude) → studio never loads remotes; preview is the
    blog/example origin.

Dismissed: Codex's "no evaluator escape demonstrated" — contradicted by Claude's executed probe.

Boss post-revision check: grep-verified each change in `composed.md` and the plans; read plan 01
and restored the concrete artifacts (catalog, manifest shape, `Hello` template, harness outline)
that the revision had compressed away under the word cap. No implementation evidence exists yet;
every "to be proven by" in the plans is pending.
