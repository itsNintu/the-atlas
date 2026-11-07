# Third-party components and references

The Atlas application implementation is original Apache-2.0 code. No Graphiti code is bundled.
A source distribution includes neither Bun, node_modules nor browser binaries.

Installed development dependencies (see bun.lock for exact resolved versions/integrity):

- TypeScript — Apache-2.0
- Playwright / @playwright/test / playwright-core — Apache-2.0
- @types/bun, bun-types, @types/node, undici-types — MIT

Retain each package's notices when redistributing installed components. Bun is an external runtime
under MIT with additional bundled component notices; refer to https://github.com/oven-sh/bun.

Background comparisons, not compatibility or parity claims:

- Graphiti, public temporal graph framework: https://github.com/getzep/graphiti
- Zep public product documentation: https://help.getzep.com/
- SQLite WAL and durability: https://sqlite.org/wal.html and https://sqlite.org/pragma.html#pragma_synchronous

Names belong to their respective owners. No affiliation or endorsement is implied.
