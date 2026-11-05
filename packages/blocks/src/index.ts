import type { ComponentType } from "react";
import type { PropsSchema, PropsOf } from "./schema.ts";
export * from "./schema.ts";
export { staticValue } from "./static-value.ts";
export * from "./lock.ts";
export const SHARED_SINGLETONS = ["react", "react-dom", "react/jsx-runtime"] as const;
export interface BlockDefinition<S extends PropsSchema> {
  readonly kind: "inline" | "block";
  readonly props: S;
  readonly sample: PropsOf<S>;
  readonly editor?: { readonly label?: string };
  readonly component: ComponentType<PropsOf<S>>;
  readonly fallback: (props: PropsOf<S>) => string;
}
export function defineBlock<const S extends PropsSchema>(
  definition: BlockDefinition<S>,
): BlockDefinition<S> {
  return definition;
}

export { jsxProps } from "./jsx-props.ts";
