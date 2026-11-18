# Radius

The Radius plugin provides a way to visualize and manage Radius applications. It builds upon the work of [Radius](https://radapp.io/) .

Radius is a cloud-native application platform that enables developers to collaborate with platform engineers to deliver and manage cloud-native applications across public clouds and private infrastructure.

The Radius Headlamp plugin provides comprehensive views in Headlamp for Radius applications, environments and other Radius resources.
The plugin adds a new item (Radius) to the sidebar to give the user an overview of the Radius installation on the cluster.

## Radius Installation

Please refer to the [official installation guide](https://docs.radapp.io/tutorials/install-radius/) for Radius to learn how to install it.

## Plugin Installation in Headlamp for Desktop

Go to the Plugin Catalog, search for the Radius plugin, and click the Install button. Reload the UI (Navigation menu > Reload, or use the notification after installing the plugin) to see the new Radius item in the sidebar.

## Application graph

This fork adds an **Application graph** section before the application resource
table. It uses the shared Radius core and React graph libraries from
ai-extensions, inside Headlamp's React tree. The existing details, tables,
routes, and API version setting stay in place.

The graph reads the application's real `getGraph` action through Headlamp's
authenticated cluster proxy:

```text
POST /apis/api.ucp.dev/v1alpha3{full-application-id}/getGraph?api-version=2023-10-01-preview
Content-Type: application/json

{}
```

The API version comes from the existing Radius plugin setting. Applications
still use `Applications.Core`, not `Radius.Core`. The
[legacy action contract](https://github.com/radius-project/radius/blob/b934a5984d5a6798f52643c8c4d0ad47bf535962/swagger/specification/applications/resource-manager/Applications.Core/preview/2023-10-01-preview/openapi.json)
requires an object body.

Graph identity includes the selected cluster, plane, and full application ID.
Changing that context or the API version clears the old graph and fetches new
data. Late responses cannot replace the current graph. **Reload graph** fetches
again. Errors have a **Retry** action and do not hide the resource table.

The shared renderer supplies zoom controls, keyboard resource details, light
and dark themes, empty states, and data warnings. Select a card or use its
details button. Press Escape to close the details panel and return focus.
For a selected resource in the existing local resource inventory, the link
below the graph opens Headlamp's resource detail page. Other resource types
remain visible but have no invalid detail link.

Connections come only from the action response, not from the fixed-type
resource table. The graph does not infer a successful deployment. This change
adds no AI modeling, deployment actions, Copilot integration, or cluster
permission grants. Users need access to the existing Radius APIs and the
`getGraph` POST action through Kubernetes API aggregation.

## Build this fork

Run commands in `radius/`, not the repository root:

```sh
npm ci
npm run tsc
npm run lint
npm run format -- --check
CI=true npm run test
npm run build
npm run package
```

Use the package from this build to install the fork; the Plugin Catalog still
serves the upstream release. `npm run build` writes `dist/`. The package command
writes `headlamp-k8s-radius-0.1.1.tar.gz`, which can be extracted into an isolated
Headlamp plugin directory. Do not overwrite the checked-in `0.1.1/` release.
The package includes the Radius license and bundled dependency notices.

The plugin retains SDK `0.14.0`, TypeScript `5.6.2`, and one React/ReactDOM
`18.3.1` runtime. Two pinned local library archives are used because suitable
registry packages could not be retrieved. See [dependency provenance and
rebuild instructions](vendor/README.md) for the exact source commit, versions,
hashes, and licenses.

The shared source build requires Node 24 and pnpm 12.15.0. Plugin installation,
type checks, lint, tests, build, and packaging pass with Linux Node 22.23.5 and
npm 10.9.9. Core still declares Node `>=24 <25`; npm reports `EBADENGINE` on Node
22. An engine-strict install is not supported on Node 22. No engine metadata
or repository-wide CI configuration was changed.

SDK 0.14.0's `tsc`, `lint`, `format`, and `test` command wrappers cannot start
their `.cmd` tools with current Node on Windows. Use Linux/WSL for the commands
above. On Windows, the same tools can be called with `node` and their JavaScript
entry points; the production build and package commands are not affected.

## Built-host checks and limits

With Docker and a Playwright Chromium browser installed, run:

```sh
npm run build
npm exec playwright install chromium
npm run test:headlamp
```

Set `PLAYWRIGHT_CHANNEL=msedge` to use an installed Edge browser instead.
Set `RADIUS_QUALIFICATION_DIR` to retain evidence in a chosen directory.
The check starts a separate, digest-pinned official Headlamp v0.45.0 container,
loads the built plugin, uses fixture API responses, and removes its container
when finished. It never uses a user's kubeconfig or Headlamp installation.
It saves screenshots, request records, package hashes, and a receipt.

The check passed with Edge `157.0.4341.60` on Windows. It covers finite node
geometry and edges, zoom, keyboard details and focus return, safe resource
navigation, route re-entry, loading failures and retry, malformed/empty data,
warnings, and light/dark themes. A separate real React Flow graph inside the
host checks that Radius CSS does not change host graph controls in either
stylesheet order.

No live Radius cluster was available. Live API behavior, credentials, and
Kubernetes authorization are **not verified** by fixture tests. No Electron
or older-browser support is claimed. The public graph CSS uses `@scope` and
requires Chromium/Edge 118+, Safari 17.4+, or Firefox 146+. Host plugin
unload/reload, reconnect, ingress CSP, and other browser versions need separate
checks. Existing application/environment access remains unchanged.

## Resources

- [Radius Documentation](https://docs.radapp.io/)
- [Radius GitHub Repository](https://github.com/radius-project/radius)
- [Headlamp Documentation](https://headlamp.dev/)
- [Headlamp GitHub Repository](https://github.com/headlamp-k8s/headlamp)
