# composed-cli

Run with mise's Node 22.22.3 using `apps/cli/bin/composed`. Short commands acquire inline ownership when studio is absent. `composed preview <doc> --to <directory>` automatically starts `composed studio --headless`; studio serves the editor on 4747 and artifacts on 4848. Set COMPOSED_HOME to isolate the workspace and COMPOSED_PORT / COMPOSED_ARTIFACT_PORT to override ports.

Every mutation accepts `--request <id>`. Retry an identical request to recover its original durable result; changing semantic arguments with the same ID yields RequestConflict. Stop studio with SIGTERM; the kernel releases ownership even after SIGKILL.
