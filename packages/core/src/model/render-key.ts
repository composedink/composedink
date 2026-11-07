import { createHash } from "node:crypto";
import { canonical, jsxProps } from "@composedink/blocks";

/**
 * The key of one block usage on a shared link page: the SHA-256 (hex) of the canonical
 * `{tag, props}`, with the literal JSX props before schema defaults. The server never sees prop
 * schemas, so the authority (render snapshot) and the server (link page) hash the same input.
 * Throws when an attribute is not a literal, as `jsxProps` does.
 */
export function renderKey(tag: string, attributes: unknown) {
  return createHash("sha256")
    .update(canonical({ tag, props: jsxProps(attributes) }))
    .digest("hex");
}
