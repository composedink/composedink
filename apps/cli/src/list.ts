import type { DocSummary } from "@composedink/core";
/** `composed list`: one row per post, newest first, as an aligned plain-text table. */
export function listTable(result: unknown) {
  const { docs } = result as { docs: DocSummary[] };
  if (!docs.length) return "No posts yet. Start one with: composed new post <slug>\n";
  const rows = [
    ["SLUG", "TITLE", "KIND", "WORDS", "UPDATED"],
    ...docs.map((d) => [
      d.id,
      d.title,
      d.kind,
      String(d.words),
      new Date(d.updatedAt).toISOString().slice(0, 16).replace("T", " "),
    ]),
  ];
  const widths = rows[0].map((_, c) => Math.max(...rows.map((r) => r[c].length)));
  return rows
    .map((r) =>
      r
        .map((cell, c) => (c === 3 ? cell.padStart(widths[c]) : cell.padEnd(widths[c])))
        .join("  ")
        .trimEnd(),
    )
    .join("\n")
    .concat("\n");
}
