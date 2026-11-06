import { alternatives } from "./alternatives.ts";
import { interval, anchors } from "./selection.ts";
import { LoroDoc, LoroMap, type ContainerID } from "loro-crdt";
import { head } from "./read.ts";
import { KEYS } from "./keys.ts";

export type Inverse =
  | { id: string; kind: "create"; base: string }
  | {
      id: string;
      kind: "change";
      bytes: Uint8Array;
      targets: ContainerID[];
      guards: { target: ContainerID; key: string; expected: string | undefined }[];
    };
export function inverse(id: string, before: LoroDoc | undefined, after: LoroDoc): Inverse {
  if (!before) return { id, kind: "create", base: head(after) };
  const branch = after.fork();
  const from = branch.version();
  const changes = branch.diff(after.frontiers(), before.frontiers());
  const targets = changes
    .map(([target]) => target)
    .filter((target) => {
      const c = after.getContainerById(target);
      return c?.isAttached() && !("isDeleted" in c && c.isDeleted());
    });
  const guards = changes.flatMap(([target, diff]) => {
    const container = after.getContainerById(target);
    if (!targets.includes(target)) return [];
    if (diff.type !== "map" || !(container instanceof LoroMap)) return [];
    const values = container.toJSON();
    return Object.keys(diff.updated).map((key) => ({
      target,
      key,
      expected: JSON.stringify(values[key]),
    }));
  });
  branch.applyDiff(changes, { fullState: true });
  if (before.getMap("meta").get("kind") === "post")
    for (const alt of alternatives(before)) {
      if (
        !changes.some(([target]) => target === before.getText("mdx").id) &&
        JSON.stringify(before.getMap("alts").toJSON()[alt.id]) ===
          JSON.stringify(after.getMap("alts").toJSON()[alt.id])
      )
        continue;
      const r = interval(before, alt);
      const target = branch.getMap("alts").get(alt.id);
      if (target instanceof LoroMap) {
        const a = anchors(branch, r.from, r.to);
        target.set("start", a.start);
        target.set("end", a.end);
      }
    }
  branch.commit({ origin: "operation-inverse" });
  return { id, kind: "change", bytes: branch.export({ mode: "update", from }), targets, guards };
}
export function applyInverse(doc: LoroDoc, action: Inverse) {
  if (doc.getMap(KEYS.meta).get("deleted")) throw Error("DetachedTarget: document removed");
  if (action.kind === "create") {
    if (head(doc) !== action.base) throw Error("TargetBusy: created document has subsequent edits");
    doc.getMap(KEYS.meta).set("deleted", true);
    doc.commit();
  } else {
    for (const guard of action.guards) {
      const container = doc.getContainerById(guard.target);
      if (
        !(container instanceof LoroMap) ||
        JSON.stringify(container.toJSON()[guard.key]) !== guard.expected
      )
        throw Error(`DetachedTarget: operation field changed: ${guard.key}`);
    }
    for (const target of action.targets) {
      const container = doc.getContainerById(target);
      if (
        !container ||
        !container.isAttached() ||
        ("isDeleted" in container && container.isDeleted())
      )
        throw Error(`DetachedTarget: ${target}`);
    }
    doc.import(action.bytes);
  }
}
