# composed-web

Studio’s Vite source editor is served by `composed studio --headless`, with an authenticated
WebSocket to the local authority. Open `/?doc=<slug>` after creating a post. It retains
unacknowledged typing updates during disconnects; wait for **Saved** before closing the tab.
Reloading a tab discards its in-memory pending bytes and session undo history.

The source pane styles Markdown/MDX and reports UTF-16 selection context. Block chips parse
static props using export’s schema/defaults contract; they never execute component code.
Set the blog preview URL to open the host on its own origin. The workspace actions panel
accepts the shipped operations’ JSON inputs and displays their results/errors.

⌘Z / Ctrl+Z undoes local typing through the binding’s Loro UndoManager. **Undo operation**
uses the authority’s separate session stack for document mutations from this studio session,
including across reconnects. CLI/agent operations and normalization imports do not enter that
stack. An inverse whose target changed or detached fails visibly. Preview export delivers a
pair of external files; operation undo does not retract published/exported files.

`sourceEditor` accepts CodeMirror extensions for decorations; `PostEditor` accepts additional
panels. Alternatives, dim, stash, lint and rewrite controls belong to later plans.

Run `mise exec -- vp run composed-web#test`, `mise exec -- vp run composed-web#e2e`, and
`mise exec -- vp run composed-web#build` from the repository root. The e2e harness starts a real
studio with an isolated temporary home and records evidence under root `test-results/`.
