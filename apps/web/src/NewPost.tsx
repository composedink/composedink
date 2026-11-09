import { useEffect, useMemo, useRef, useState } from "react";
import { setFrontmatterField } from "@composedink/core";
import { describe, Notice, type NoticeContent } from "./Notice";
import type { StudioClient } from "./studio";

/** A kind as the chooser shows it: its reading values and the template's headings. */
export interface KindChoice {
  kind: string;
  reader: string;
  medium: string;
  budget: number;
  headings: string[];
}
const MEDIUM: Record<string, string> = { phone: "phone", screen: "screen", web: "the web" };
export const kindName = (kind: string) =>
  kind.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());
/** Lowercase words joined by hyphens, accents dropped; empty titles fall back to "untitled". */
export function slugify(title: string) {
  return (
    title
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64)
      .replace(/-+$/, "") || "untitled"
  );
}
/** The slug, or the first of `slug-2`, `slug-3`, … that no post uses. */
export function unique(slug: string, taken: ReadonlySet<string>) {
  if (!taken.has(slug)) return slug;
  for (let n = 2; ; n++) if (!taken.has(`${slug}-${n}`)) return `${slug}-${n}`;
}
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
async function loadKinds(client: StudioClient): Promise<KindChoice[]> {
  const list = (await client.operation("kind.list", {})) as { kind: string }[];
  const kinds = await Promise.all(
    list.map(async ({ kind }) => {
      const { files } = (await client.operation("kind.read", { kind })) as {
        files: Record<string, string>;
      };
      try {
        const config = JSON.parse(files["kind.json"]);
        const headings = [...files["template.mdx"].matchAll(/^#{1,6}\s+(.+)$/gm)].map((m) =>
          m[1].trim(),
        );
        return {
          kind,
          reader: String(config.reader),
          medium: String(config.medium),
          budget: Number(config.budget),
          headings,
        };
      } catch {
        return undefined;
      }
    }),
  );
  const valid = kinds.filter((k): k is KindChoice => !!k);
  // The everyday kind first, the rest alphabetically.
  return valid.sort(
    (a, b) => Number(b.kind === "post") - Number(a.kind === "post") || a.kind.localeCompare(b.kind),
  );
}
/**
 * New post: a title, an editable slug derived from it, and a kind. Submit creates the post, writes
 * the title into its settings block and opens it. Escape or Cancel returns to the list.
 */
export function NewPost({
  client,
  taken,
  onCancel,
}: {
  client: StudioClient;
  taken: ReadonlySet<string>;
  onCancel: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [kinds, setKinds] = useState<KindChoice[]>();
  const [kind, setKind] = useState("post");
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<NoticeContent>();
  const derived = useMemo(() => unique(slugify(title), taken), [title, taken]);
  const finalSlug = slug ?? derived;
  useEffect(() => {
    dialog.current?.showModal();
    loadKinds(client).then(setKinds, (e) => setNotice(describe(e)));
  }, [client]);
  const slugProblem = !SLUG.test(finalSlug)
    ? "Use lowercase letters, digits and single hyphens."
    : taken.has(finalSlug)
      ? `A post called “${finalSlug}” already exists.`
      : undefined;
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || slugProblem) return;
    setBusy(true);
    setNotice(undefined);
    try {
      await client.operation("doc.create", { slug: finalSlug, kind, request: crypto.randomUUID() });
      if (title.trim()) {
        const read = (await client.operation("doc.read", { doc: finalSlug })) as {
          base: string;
          text: string;
        };
        const change = setFrontmatterField(read.text, "title", title.trim());
        await client.operation("doc.apply", {
          doc: finalSlug,
          base: read.base,
          text: read.text.slice(0, change.from) + change.insert + read.text.slice(change.to),
          mode: "direct",
          by: { kind: "human" },
          request: crypto.randomUUID(),
        });
      }
      location.assign(`?doc=${encodeURIComponent(finalSlug)}`);
    } catch (e) {
      setNotice(describe(e));
      setBusy(false);
    }
  };
  return (
    <dialog
      ref={dialog}
      className="new-post"
      aria-labelledby="new-post-heading"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
    >
      <form onSubmit={(e) => void submit(e)}>
        <h2 id="new-post-heading">New post</h2>
        <label className="field">
          <span className="field-label">Title</span>
          <input
            autoFocus
            name="title"
            value={title}
            placeholder="What is this post about?"
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label className="field">
          <span className="field-label">Slug</span>
          <input
            name="slug"
            value={finalSlug}
            spellCheck={false}
            aria-describedby="slug-hint"
            aria-invalid={!!slugProblem}
            onChange={(e) => setSlug(e.target.value)}
          />
          <span className="field-hint" id="slug-hint">
            {slugProblem ?? "The post's address and file name. You can change it now, not later."}
          </span>
        </label>
        <fieldset className="kinds">
          <legend className="field-label">Kind</legend>
          {kinds === undefined && !notice && <p className="muted">Loading kinds…</p>}
          {kinds?.map((k) => (
            <label key={k.kind} className="kind-option" data-kind={k.kind}>
              <input
                type="radio"
                name="kind"
                value={k.kind}
                checked={kind === k.kind}
                onChange={() => setKind(k.kind)}
              />
              <span className="kind-body">
                <span className="kind-name">{kindName(k.kind)}</span>
                <span className="kind-facts">
                  For {k.reader}, read on {MEDIUM[k.medium] ?? k.medium}, {k.budget} words
                </span>
                {k.headings.length > 0 && (
                  <span className="kind-template">{k.headings.join(" · ")}</span>
                )}
              </span>
            </label>
          ))}
        </fieldset>
        {notice && <Notice notice={notice} onDismiss={() => setNotice(undefined)} />}
        <div className="dialog-actions">
          <button type="button" className="quiet" onClick={onCancel}>
            Cancel
          </button>
          <button className="primary" disabled={busy || !!slugProblem || !kinds}>
            {busy ? "Creating…" : "Start writing"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
