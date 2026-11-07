# composed-rune

A native composed client drawn with [rune](https://github.com/anomalyco/rune), beside the Tauri
app in `apps/desktop` (which it does not replace). It's a minimum viable client: list posts, open
one, write in it, create a new post, and see the studio's changes arrive live, with dimmed text
drawn faded.

## How it fits

The studio stays the only writer of the store. This app is a peer of the web editor on the same
socket and protocol (`apps/web/src/editor/transport.ts`):

- **Model** (`replica.rs`): a Rust `loro` replica of the post's `mdx` text. `loro` is pinned to
  1.17.1, the same version as the studio's `loro-crdt`, so they share an encoding.
- **Controller** (`post.rs`, `link.rs`): typing is spliced into the replica as the smallest byte
  change and sent as a Loro update with a sequence number. The studio imports it unchanged and
  normalizes it. Unacknowledged updates are retained and sent again after every snapshot, so a
  dropped socket loses nothing. Studio commits come back as updates and are folded into the
  draft with the caret mapped across them. The socket runs on its own thread and wakes rune
  per frame.
- **View** (`main.rs`): post list, editor (`text_input` with the `dim` marks as decorations),
  and a status bar with save state and word count. `poll` is the controller loop: local typing,
  then studio frames, then the post list.
- **Discovery** (`home.rs`): reads `$COMPOSED_HOME/owner.json` and `session.token` to find the
  socket, and lists posts from `docs/` directory names (read-only). The studio has no listing
  operation yet; a `doc.list` op would replace the directory read.

## Run

Rust 1.99.1 is pinned in this folder's `mise.toml`, separately from the Tauri app's 1.91.1.

```sh
cd apps/desktop-rune
mise exec -- cargo run                     # window against $COMPOSED_HOME (default ~/.composed)
mise exec -- cargo run -- --snap shot.png --scene draft   # headless render, no studio
```

With no studio running, the status bar offers **Start studio**, which runs
`composed studio --headless`. Set `COMPOSED_CLI` when `composed` isn't on PATH, for example
`COMPOSED_CLI=$PWD/../cli/bin/composed`.

## Test

```sh
mise exec -- cargo test                    # unit tests and a headless UI test
COMPOSED_CLI=$PWD/../cli/bin/composed mise exec -- cargo test --test studio -- --nocapture
```

The second command runs against a real studio in a temporary home. It types through the client
and reads the result back with `composed cat`, then edits through `composed apply` and checks
the client receives it with the caret held. Without `COMPOSED_CLI` it skips.

## Not yet

Alternatives (flip, propose), dim and stash actions, lint underlines, threads, kinds, zen and
the sparkline all exist in the web editor and not here. The editor shows raw MDX, frontmatter
included. Undo history resets when the studio changes the text. There's no packaging or code
signing; `cargo run` only. The native window has not been driven by System Events yet: the
screen was locked when it was tried.
