/**
 * `@composedink/core/model`: the document model without build tools, for the server's replicas.
 * `apply.ts` and `validate.ts` (MDX compiler), `inverse.ts` (authority undo) and
 * `component-template.ts` stay out; `tests/model-entry.test.ts` walks the imports.
 */
export { KEYS } from "./keys.ts";
export { isPost, importTyping, importSynced } from "./text.ts";
export * from "./threads.ts";
export * from "./feedback.ts";
export { read, head } from "./read.ts";
export * from "./projection.ts";
export * from "./selection.ts";
export { renderKey } from "./render-key.ts";
