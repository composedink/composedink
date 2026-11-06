# Artifact server

Run `COMPOSED_TOKEN=... COMPOSED_STORAGE=./data mise exec -- vp run composed-server#start`.
The storage directory is private to the server; provision a writable volume owned by UID 1000.
Build from repository root: `docker build -f apps/server/Dockerfile .`.

Authenticated PUT `/c/<scope>/<name>/<version>/<file>` stages immutable files.
Finally PUT `release.json` containing `{ "files": { "remoteEntry.js": "<sha256>", ... } }`.
Only a complete hash-verified set becomes public, via atomic directory rename. Same bytes
return 200, conflicting bytes or an incomplete commit return 409. A committed version
cannot gain files. GET is public with CORS and immutable caching. Mount persistent storage;
keep the bearer token in the environment, never in documents or locks. This app does not
bundle components, deploy itself, or publish npm packages.
