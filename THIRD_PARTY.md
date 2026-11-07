# Third-party components and references

The Atlas application implementation is original Apache-2.0 code. No Graphiti code is bundled.
A source distribution includes neither Bun, node_modules nor browser binaries.

Installed runtime dependency: `tiktoken` (MIT), the WebAssembly tokenizer bindings from
https://github.com/dqbd/tiktoken. See bun.lock for resolved integrity and retain installed notices.
The native operator's separately configured inference/embedding commands are not bundled dependencies.

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

## Bundled brand assets

`ui/brand/` contains the selected Space Grotesk variable font and IBM Plex Mono
Regular/Medium under their original SIL OFL licenses, included alongside them.
The official Creator Labs white symbol is an owner-provided brand/trademark asset,
not Apache-2.0 artwork. See `ui/brand/README.md` and `sources.json` for exact upstream
sources, hashes and rights. Atlas code remains Apache-2.0; this does not relicense
fonts or grant rights to the Creator Labs mark. No licensed UI vendor code is bundled.

Names belong to their respective owners. Third-party research references do not
imply affiliation or endorsement; Creator Labs is Atlas's identified parent/publisher.
