# Tunnelde Plugin SDK

Versioned RPC and frontend SDK, manifest validators, deterministic packaging and plugin development documentation extracted from Tunnelde Hub.

Install a pinned GitHub Release tarball as a development dependency. Runtime SDK files must be bundled or copied into your plugin; installation never executes npm.

Run `npm ci --ignore-scripts`, `npm run verify`. Synchronize a selected Tunnelde checkout with `npm run sdk:sync -- /path/to/Tunnelde`; the generated contract is pinned in this repository.

[SDK API](sdk/README.md) · [Development documentation](docs/README.md) · [Examples](examples/README.md)
