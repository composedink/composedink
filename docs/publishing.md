# Local publication and integration packages

Set an artifact server token in its environment and run the server as described in
[the server README](../apps/server/README.md). On the author device, configure an
HTTP(S) server and the name of an environment variable containing its token:

```sh
composed config scope lachieh --server http://127.0.0.1:4849 --token-ref COMPOSED_TOKEN
composed component publish lachieh/hello --minor --request hello-release-001
composed deps pin post Hello 0.1.0
composed export post --to ./content
```

Use the version returned by publish. Keep the request ID for a retry after a lost
acknowledgement; changing its payload fails. The durable publish intent retains the
version, original frontiers, resolved source hash and exact upload bytes. Failed
uploads never add a release record. Scope configuration and environment references
remain device-local. Existing release locks retain their absolute artifact URLs.
`composed preview` produces development locks; production builds render these as
fallback only and emit an instruction to export a release.

Accept an edited exported file with `composed import post --file
./content/post/index.mdx`. In a noninteractive human script, add `--i-am-human`.
Import is excluded from MCP. Export performs the same reconciliation automatically.
Keep the sibling lock and device export history: they identify the retained base;
unknown bases, mismatched pairs and restored earlier files require explicit recovery.

The three integration packages use TypeScript source exports in the workspace.
`vp pack` emits JavaScript and declarations; `pnpm pack` applies `publishConfig.exports`
to archives containing only the compiled distribution and documentation. React stays
a peer dependency. Run the isolated consumer gate from the repository root:

```sh
mise exec -- node --experimental-strip-types tests/tarball-consumer.ts
```

It packs all three libraries, installs the archives into an isolated copy of the
example, checks that no package resolves to a workspace source link, and builds a
release-lock post with external network access denied. Local overrides resolve the
unpublished sibling archives without an npm registry release.

Actual npm publication belongs to Plan 12. For that separately authorized release,
choose package versions, update sibling requirements, run all gates and archive builds,
and authenticate an npm account with publish access to the `@composedink` organization
using npm credentials supplied securely on the release device. Review the tarball
contents and exports before publishing each archive with public access and the required
npm OTP/provenance settings. No credential belongs in this repository. This plan does
not execute registry publication or deployment.
