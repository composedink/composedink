# Composed for macOS

This Tauri 2 window runs the existing studio and editor. Development needs mise,
Xcode Command Line Tools, and macOS 12 or newer. Install and run from the repository:

```sh
mise install
mise exec -- vp install
mise exec -- vp run composed-desktop#dev
mise exec -- vp run composed-desktop#package
mise exec -- vp run composed-desktop#smoke
```

The app is at `src-tauri/target/release/bundle/macos/Composed.app`. It is **ad-hoc
signed and not notarized**. This is a local build, not an authorized release; macOS
may block a downloaded copy. Signing/notarization credentials are out of scope.
Build on each target Mac architecture; this build is not a universal binary.

The package includes mise Node 22, pnpm, the CLI dependency graph, Rspack/Rolldown
native bindings, Loro and Harper WASM, worker entrypoints and built web assets.
The runtime archive preserves pnpm symlinks. On first launch it extracts atomically
into the app cache, keyed by the archive SHA-256. With COMPOSED_HOME set, the cache
is under that home for isolated smoke runs. It never discovers Node on the user's
PATH. Component builds use bundled pnpm/Node and the catalog to materialize exact
component dependency locks under COMPOSED_HOME/build. Uncached npm dependencies
still need registry access. See Plan 11's log for the SEA experiment and evidence.

The sidecar attaches to the same COMPOSED_HOME SQLite authority used by terminal
`composed` commands (default `~/.composed`). It waits for short inline commands,
starts headless studio when absent, reconnects after authority death and never
terminates a studio started by someone else. Closing the window detaches its lease;
a desktop-started authority waits two seconds after its last client disconnects,
flushes queued writes, then exits. Registered preview subscriptions also keep it alive. A connected terminal client retains the owner.
The selected document is device-local editor state; it is not document metadata.

The studio binds only 127.0.0.1, authenticates operations using a random session
token and exact Origin, and rejects foreign HTTP Host/Origin requests. The window
accepts navigation only within the handshake origin and exposes no native commands
or generic shell execution. Components execute only in the separate blog/example
preview origin. This desktop shell is not the P3 untrusted-code isolation boundary.

The smoke requires a logged-in macOS GUI session, Accessibility permission for the
terminal running it, and Screen Recording permission for screenshot evidence. It
uses the packaged binary with PATH=/usr/bin:/bin and an isolated COMPOSED_HOME.
`smoke:runtime` drives the extracted packaged studio and built web editor in headless
Chromium, including CLI writes/reads, SQLite exclusion, persistence, security,
Harper and a separate-origin hook remote/failure fallback. `smoke:gui` is the
separately named native window typing/relaunch/screenshot check. It reports
`skipped: gui session locked` with an explicit reason when macOS is locked; this
is pending native acceptance, not a passing window test. Run it again when unlocked.
The headless screenshot proves the packaged editor surface, not the native window.
Evidence and the packaged build remain local under test-results/ and target/.
