# @composedink/core

Source exports require a TypeScript-aware Node 22.22.3 runtime. Acquire ownership before opening writable documents:

```ts
import { acquire, openStore, authority, bind } from "@composedink/core/node";
const lock = await acquire(home, "inline");
if (lock.kind === "owner") {
  try {
    const run = bind(await authority(await openStore(home)));
    await run("doc.create", { slug: "draft", request: "create-draft" });
  } finally {
    await lock.close();
  }
}
```

A `connect` result supplies the studio socket metadata; use the CLI transport instead of opening another writer. Inline ownership is for short commands. Studio owns long-running previews. `authority.db` holds only the kernel lock. `state.db` indexes store-local receipts, history and intents; `state/receipts` envelopes atomically commit document bytes, results and prepared export effects. A failed durable commit requires restart before further writes. Full-history snapshots retain old bases through compaction. Corrupt committed segments and unexpected outside edits raise RecoveryRequired and preserve the evidence.

Run `mise exec -- vp run @composedink/core#durability` for real-process election, kill-point recovery, receipts and historical-base coverage.
