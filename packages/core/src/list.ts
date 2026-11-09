import type { Authority } from "./authority.ts";
import type { DocSummary } from "./index.ts";
import { frontmatterValues } from "./kinds.ts";
import { KEYS } from "./model/keys.ts";
import { isPost } from "./model/text.ts";
import { bodyWords } from "./words.ts";
/**
 * Every post on this home, newest first. The title is the frontmatter `title` when the block parses
 * and has one, else the slug; a post whose frontmatter is broken still lists.
 */
export async function listDocs(a: Authority): Promise<{ docs: DocSummary[] }> {
  const docs: DocSummary[] = [];
  for (const [id, doc] of a.documents) {
    const meta = doc.getMap(KEYS.meta);
    if (!isPost(doc) || meta.get("deleted")) continue;
    const text = doc.getText(KEYS.mdx).toString();
    const title = frontmatterValues(text).title;
    const kind = meta.get("kind");
    docs.push({
      id,
      title: typeof title === "string" && title.trim() ? title.trim() : String(meta.get("slug")),
      kind: typeof kind === "string" ? kind : "post",
      words: bodyWords(text),
      updatedAt: await a.store.updatedAt(id),
    });
  }
  docs.sort((x, y) => y.updatedAt - x.updatedAt || x.id.localeCompare(y.id));
  return { docs };
}
