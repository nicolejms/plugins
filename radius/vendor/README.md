# Pinned Radius libraries

These are compiled, unmodified npm packages from
[radius-project/ai-extensions](https://github.com/radius-project/ai-extensions/tree/5e52cb77a6ccc75bf061c357e8ba5a5ac9d507c8),
commit `5e52cb77a6ccc75bf061c357e8ba5a5ac9d507c8`.

| File | Version | SHA-256 |
| --- | --- | --- |
| `radius-project-core-0.1.0.tgz` | `0.1.0` | `64e31db76931ffc91093088b79e1409bc00c9cade2ef0979cf2c22775a126394` |
| `radius-project-graph-react-0.1.0.tgz` | `0.1.0` | `3e6dc9928a905540341992c670aced2af392a3cfa1f3cf238e05178f7d17b4ca` |

Both packages use Apache-2.0. Each archive contains `dist/LICENSE`.
The graph archive also contains `dist/THIRD_PARTY_NOTICES.txt` for its
compiled Dagre, graphlib, and lodash dependencies. Keep those notices with
redistributed builds. No Canvas adapter or source copy is included.

The configured npm mirror returned 404 for both package names on 2026-11-18.
Direct npm registry requests failed with a TLS handshake error. These results
do not prove that no public package exists. This integration uses the approved
local artifact fallback instead of an unverified registry version.

## Rebuild

Use an isolated checkout, Node `24.22.2`, and pnpm `12.15.0`. Do not build in
a user's main ai-extensions checkout.

```sh
git clone https://github.com/radius-project/ai-extensions.git
cd ai-extensions
git checkout --detach 5e52cb77a6ccc75bf061c357e8ba5a5ac9d507c8
pnpm install --frozen-lockfile
pnpm run build:libraries
pnpm --filter @radius-project/core --filter @radius-project/graph-react pack --pack-destination .artifacts/headlamp-tarballs
```

Copy the two archives from `.artifacts/headlamp-tarballs` into this directory.
Check their SHA-256 hashes against the table. Do not edit the packed manifests,
engines, or code. No package publication or release workflow is needed.
pnpm applies each package's `publishConfig` during packing, so the public
exports point at compiled ESM and declarations, not workspace source.

The plugin's direct `file:` dependencies and npm override
`"@radius-project/core": "$@radius-project/core"` make graph-react resolve the
same core archive. `package-lock.json` records archive integrity. There is no
registry request for an unpublished core version and no sibling directory
dependency. React and ReactDOM remain Headlamp's `18.3.1` peers.

The core package declares Node `>=24 <25`; this metadata is unchanged.
Only its browser-safe `/domain` and `/graph` entry points are used.
The plugin is checked with Node 22 and the existing SDK and compiler; a
successful build does not expand the upstream package's declared support.
An install with `engine-strict=true` on Node 22 will reject core. Do not
disable that policy or edit the archive to work around it.
