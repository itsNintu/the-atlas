# Contributing

Install Bun 1.4.4+, clone, and run `bun install --frozen-lockfile`. `bun run check`, `bun test tests`
and `bun run test:e2e` need no private service. Browser checks use `bunx playwright install chromium`
and `bun run test:ui`. `bun run bench` creates disclosed generated data and deletes private databases.

Read AGENTS.md and docs/contract.md. Add regression coverage for authorization, lifecycle/time, async
failure or budget changes. Keep public fixtures deliberately synthetic. No real credentials, source
payloads, provider response dumps or unrelated private documents belong in patches or issues.

Runtime code uses Bun/node builtins and SQLite. Keep dependencies justified and compatible with
Apache-2.0. Upstream reuse is allowed with license/attribution review and the same behavioral tests;
there is no blanket rewrite or no-reuse rule. Submit focused changes with actual verification output.
