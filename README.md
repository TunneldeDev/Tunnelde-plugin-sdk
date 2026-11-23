# Tunnelde Plugin SDK

Versioned RPC and frontend SDK, manifest validators, deterministic packaging and plugin development documentation extracted from Tunnelde Hub.

Install a pinned GitHub Release tarball as a development dependency. Runtime SDK files must be bundled or copied into your plugin; installation never executes npm.

Run `npm ci --ignore-scripts`, `npm run verify`. Synchronize a selected Tunnelde checkout with `npm run sdk:sync -- /path/to/Tunnelde`; the generated contract is pinned in this repository.

[SDK API](sdk/README.md) · [Development documentation](docs/README.md) · [Examples](examples/README.md)

SDK 1.0.x preserves the contract snapshot extracted from Hub commit `1a204c979b604ac756ff32645f4962b5dba66ecf`. Synchronizing a newer Tunnelde dev checkout is an explicit SDK release change; independent plugin releases do not require an unrelated moving host catalogue to remain unchanged.
