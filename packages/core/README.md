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

Model rewrites use an OpenAI-compatible endpoint. Create `$COMPOSED_HOME/config.json`
(default `~/.composed/config.json`) on this device:

```json
{
  "rewrite": {
    "endpoint": "http://127.0.0.1:11434/v1/chat/completions",
    "model": "llama3.2",
    "timeoutMs": 60000
  }
}
```

This example works with an already-running Ollama server and an installed llama3.2
model. Ollama is optional; tests use a local HTTP double. For a hosted provider,
set its complete `/v1/chat/completions` URL and add `"tokenRef": "COMPOSED_MODEL_TOKEN"`.
Set that environment variable before launching studio or CLI; the config stores only
the reference. Restart studio to change its environment. Endpoint/model are read for
each request. No endpoint, token reference or credential is stored in documents or
export locks. Prompts and provider response/error bodies are not logged by default.

```sh
composed alt rewrite draft --base <base-from-cat-json> --quote 'Selected text.' --count 3
```

Optional `--instruction`, `--nth`, `--view` and `--request` refine the request. Reuse
`--request` after a lost acknowledgement to replay the committed result. Failed or
cancelled requests can retry; use a new request ID for a different payload. The
provider request permits 1–16 versions, a 1 MiB response and a configurable timeout
as resource controls; selected prose has no artificial length limit and is never
trimmed. Responses must contain exactly that many distinct, nonempty strings in a
JSON array. ProviderFailed names the configuration/check needed before retrying.

In studio, select text and press Mod-Shift-R. The pending control cancels before
commit; a completed receipt wins a cancellation race. The original remains version
1/4. Alt-↑/↓ flips; Mod-Enter keeps. Edits continue while the provider waits; deleted
targets go to detached stash. Core embedders may pass an AbortSignal as the fourth
argument to the bound operation function.
