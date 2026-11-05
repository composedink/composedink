import * as React from "react";
import * as ReactDOM from "react-dom";
import * as JSXRuntime from "react/jsx-runtime";
import { blockLoader } from "@composedink/host-runtime";
import type { LockedBlock, JsonValue } from "@composedink/blocks";
let loader: ReturnType<typeof blockLoader> | undefined;
const warned = new Set<string>();
function warn(block: LockedBlock) {
  const key = `${block.id}@${block.version}`;
  if (!warned.has(key)) {
    warned.add(key);
    console.warn(`composed: failed ${key}`);
  }
}
class Boundary extends React.Component<
  { block: LockedBlock; fallback: React.ReactNode; children: React.ReactNode; tag: "span" | "div" },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    warn(this.props.block);
  }
  render() {
    const Tag = this.props.tag;
    return this.state.failed ? (
      <Tag data-composed={this.props.block.id} data-state="failed">
        {this.props.fallback}
      </Tag>
    ) : (
      this.props.children
    );
  }
}
export function ComposedBlock({
  use: block,
  props,
  children,
  production = false,
}: {
  use: LockedBlock;
  props: Record<string, JsonValue>;
  children: React.ReactNode;
  production?: boolean;
}) {
  const [remote, setRemote] = React.useState<React.ComponentType<Record<string, JsonValue>> | null>(
    null,
  );
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => {
    if (production) return;
    let active = true;
    loader ??= blockLoader(
      Object.fromEntries(
        Object.entries({
          react: React,
          "react-dom": ReactDOM,
          "react/jsx-runtime": JSXRuntime,
        }).map(([name, lib]) => [
          name,
          {
            version: React.version,
            lib: () => lib,
            shareConfig: { singleton: true, requiredVersion: false },
          },
        ]),
      ),
    );
    loader
      .load(block)
      .then((value) => {
        if (
          !value ||
          typeof value !== "object" ||
          !("default" in value) ||
          !value.default ||
          typeof value.default !== "object" ||
          !("component" in value.default) ||
          typeof value.default.component !== "function"
        )
          throw new Error("Invalid block module");
        const component = value.default.component as React.ComponentType<Record<string, JsonValue>>;
        if (active) setRemote(() => component);
      })
      .catch(() => {
        warn(block);
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [block, production]);
  const Tag = block.kind === "inline" ? "span" : "div";
  const Remote = remote;
  return (
    <Boundary key={block.version} tag={Tag} block={block} fallback={children}>
      <Tag data-composed={block.id} data-state={failed ? "failed" : Remote ? "remote" : "fallback"}>
        {Remote ? <Remote {...props} /> : children}
      </Tag>
    </Boundary>
  );
}
