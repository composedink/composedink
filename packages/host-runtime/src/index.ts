import { createInstance } from "@module-federation/runtime";
import type { LockedBlock } from "@composedink/blocks";
type Shared = NonNullable<Parameters<typeof createInstance>[0]["shared"]>;
export function blockLoader(shared: Shared) {
  const instance = createInstance({ name: "composed_host", remotes: [], shared });
  const registered = new Set<string>();
  return {
    async load(block: LockedBlock) {
      const bytes = new TextEncoder().encode(`${block.id}${block.version}`);
      const hash = await crypto.subtle.digest("SHA-256", bytes);
      const name =
        "composed_" +
        Array.from(new Uint8Array(hash), (n) => n.toString(16).padStart(2, "0")).join("");
      if (!registered.has(name)) {
        instance.registerRemotes([{ name, entry: block.entry, type: "module" }]);
        registered.add(name);
      }
      const result = await instance.loadRemote(`${name}/block`);
      if (!result) throw new Error(`Remote missing: ${block.id}`);
      return result;
    },
  };
}
