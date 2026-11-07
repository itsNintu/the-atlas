# The Atlas engineering

Apache-2.0 source-linked graph/context-memory product. M0 is a bounded alpha, not Zep parity.
Use Bun/TypeScript. Canonical code is this repository; no Hermes runtime dependency.
Read CONTEXT.md and docs/contract.md before changing behavior. Workspace is the tenant boundary;
all knowledge access requires explicit space/action grants, including workspace administrators.
Keep deterministic assertions distinct from natural-language extraction. Never fake provider results.
Run `bun install --frozen-lockfile`, `bun run check`, `bun test`, `bun run test:e2e`.
Keep credentials, data, generated private fixtures and .env files out of Git. Bootstrap writes credentials
only to an exclusive mode-0600 file, never console output. Public examples must use synthetic data.
SQLite WAL is provisional, single-node storage. Record evidence before changing architecture.
Keep docs/capabilities.md honest about shipped behavior and practical remaining work. Research and upstream reuse are available choices; this small bootstrap uses original code for a focused dependency-light lifecycle.
