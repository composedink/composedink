# composed-cli

Run with mise's Node 22.22.3 using `apps/cli/bin/composed`. Short commands acquire inline ownership when studio is absent. `composed preview <doc> --to <directory>` automatically starts `composed studio --headless`; studio serves the editor on 4747 and artifacts on 4848. Set COMPOSED_HOME to isolate the workspace and COMPOSED_PORT / COMPOSED_ARTIFACT_PORT to override ports.

Every mutation accepts `--request <id>`. Retry an identical request to recover its original durable result; changing semantic arguments with the same ID yields RequestConflict. Stop studio with SIGTERM; the kernel releases ownership even after SIGKILL.

`composed component check <scope/name>` materializes the component package and returns
its literal manifest and file/line/column diagnostics without executing block metadata.
The package's npm dependencies are bundled in its remote; React comes from the host.

`composed component edit <scope/name> <directory>` starts headless studio if needed,
checks out the files, and keeps the directory and authority synchronized. Keep
`.composed-checkout.json`: it records each file's checkout base. Saves merge at that
base, preserving concurrent authority edits. A save made during an acknowledgement
is retained locally and reported as a conflict; reconcile it with `component read`
before replacing the local file with the authority's merged text. Symlinks are rejected.
Stopping the edit command leaves studio and previews running. Failed checks, builds or
fallback evaluations report BuildFailed and retain the last good MDX/lock pair.
Preview hosts reload the page when a new immutable remote version is exported.
