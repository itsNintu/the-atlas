# The Atlas

**Source-linked graph memory for agents, with durable jobs and a bounded context response.**

The Atlas is a standalone **0.1 alpha** with a Bun/SQLite self-hosted runtime and an Atlas-owned
Cloudflare Worker/Durable Object runtime. An agent can ingest text, JSON or timestamped
messages, supply explicit relationship assertions, retrieve evidence under a character budget, inspect
provenance, correct a source, and forget it without leaving unsupported facts behind. It needs Bun and
a local filesystem for the self-hosted runtime, not Hermes, Docker, a hosted graph database, or a private account.

The production deployment for Alex's agents is `https://atlas.creator.gg`, backed by a single SQLite
Durable Object and Cloudflare alarms/cron. It is separate from Creators and does not use Convex.
See [Cloudflare deployment and recovery](docs/cloudflare.md) for the protected release/cutover workflow.

A small browser inspector uses the same real REST APIs as the JSON CLI. Workspace-bound credentials
and explicit space/action grants keep separate callers and personal/shared spaces isolated.

Current version: **0.1.0-alpha.1**. Formerly ThreadAtlas; see the
[rename and upgrade notes](docs/rename.md). API/schema and existing credentials are unchanged.

## Try it

Install [Bun](https://bun.sh/) (1.4.4 is the verified, recommended baseline), then:

```sh
git clone https://github.com/itsNintu/the-atlas.git
cd the-atlas
bun install --frozen-lockfile
bun run cli bootstrap --name 'My workspace'
bun start
```

Bootstrap writes a generated bearer credential to `data/admin.credentials.json` (mode 0600), **not** to
stdout. Start in a trusted local directory. In another terminal:

```sh
bun run cli doctor
bun run demo
```

The demo talks to your running server with the saved credential. It creates synthetic scopes and
sources, waits for actual jobs, retrieves context, traverses relationships, corrects evidence, and
forgets its sources. It prints only nonsecret results. Open <http://127.0.0.1:8787> for the inspector.
See the [step-by-step quickstart](docs/quickstart.md) for reusable CLI JSON workflows and UI login.

## What is real here

- SQLite WAL transactions with FULL synchronous durability; revisioned sources and leased/retryable
  jobs recover after process restarts. Work completion is distinct from ingestion acknowledgement.
- Explicit assertions become temporal subject–predicate–object facts. Every returned fact has
  authorized source/revision support. Exact-label graph expansion is bounded to one to three hops.
- Current and historical valid/recorded-time queries use half-open intervals. A correction supersedes
  evidence; forgetting erases source payloads/assertions across revisions and repairs support links.
- Context packing includes fact handles and obeys a Unicode-code-point character budget. Oversize
  facts are omitted, not silently truncated into misleading statements.
- A real OpenAI-compatible extraction/embedding adapter is available for opt-in `natural_language`
  sources and hybrid retrieval. It is **not required** for explicit assertions.

**Assertions are structured caller input, not natural-language extraction.** The initial verification
host had no configured supported provider key. Its real adapter probe failed actionably with
`provider_unavailable` and produced zero facts. No successful model run or semantic retrieval quality
is claimed. Set the documented provider environment variables and run `bun run provider:probe` to
verify your own configured adapter against synthetic text.

## Verify

```sh
bun run check
bun test tests
bun run test:e2e       # real server + CLI + disk + SIGKILL/restart recovery
bunx playwright install chromium
bun run test:ui        # real browser, actual APIs, desktop + mobile
bun run bench         # disclosed local generated workloads, not a scale guarantee
```

[Contract](docs/contract.md) · [Operations](docs/operations.md) ·
[Capabilities and limitations](docs/capabilities.md) · [Measurements](docs/measurements.md) ·
[Contributing](CONTRIBUTING.md) · [Security](SECURITY.md)

## Scope and tradeoffs

This is a useful single-node bootstrap, not Zep parity or an enterprise service. Lexical ranking scans
at most 5,000 time-filtered authorized facts/request; pagination is keyset-based, not a snapshot.
There is no automatic entity resolution, learned procedures, connector sync, SDK/MCP, automatic
harness capture, SSO, managed hosting or production SLA. Those are possible extensions, not claims
made by this release. SQLite makes install and transactional lifecycle recovery simple; local
measurements show synchronous single-process retrieval becomes a bottleneck under concurrency.

The implementation is original code, Apache-2.0. Reuse and alternative engines remain valid options;
this small design was chosen for a dependency-light, testable lifecycle, not because upstream reuse
is prohibited. See [the decision note](docs/decisions.md).
