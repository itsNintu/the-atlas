# The Atlas: identity and upgrade notes

Version **0.1.0-alpha.1** renames ThreadAtlas to **The Atlas**. The technical slug and source
package name are `the-atlas`; the public repository is <https://github.com/itsNintu/the-atlas>.
This is an identity/compatibility update, not a new feature or a broader product acceptance claim.

## Existing installations and data

- Current environment variables use `THE_ATLAS_` (see `.env.example`). Every corresponding
  `THREADATLAS_` variable remains a supported compatibility alias, including provider settings,
  request logging, server and CLI/demo settings. A set current variable wins over the legacy one,
  including an explicitly empty string. `OPENAI_API_KEY` remains the existing provider fallback.
- A fresh installation defaults to `data/the-atlas.sqlite`. If only `data/threadatlas.sqlite`
  exists, CLI and server reuse it automatically. They do not rename, merge or copy an existing
  database, its WAL/SHM companions, or its backups. If both names exist, set `THE_ATLAS_DB`
  explicitly (or CLI `--db`) instead of silently choosing between divergent databases.
- `data/admin.credentials.json`, credential contents, opaque IDs and the existing `ta_` token
  format stay unchanged. Do **not** re-bootstrap or reissue credentials for the rename.
  The REST v1 contract and SQLite schema 1 are unchanged. Existing saved credentials still work.
- Stop running processes before moving an existing project directory. Keep the whole directory,
  including ignored data, `.env`, private credentials and any WAL/SHM files. Custom absolute paths
  outside the project are not rewritten; update your own launch configuration if it embeds the old
  repository path. There is no always-on deployment provisioned by this project.

## Source and release continuity

```sh
git remote set-url origin https://github.com/itsNintu/the-atlas.git
git pull --ff-only
bun install --frozen-lockfile
# Existing installation: keep its saved credential; do not bootstrap again.
bun start
```

Fresh clone: follow README / docs/quickstart.md. The renamed downloadable source archive is
`the-atlas-0.1.0-alpha.1.tar.gz`, distributed with `SHA256SUMS` on
<https://github.com/itsNintu/the-atlas/releases/tag/v0.1.0-alpha.1>.
The source package remains private to npm (no npm registry publication is claimed).

The original `v0.1.0-alpha.0` tag, commit `c58a1962df27eb63b7994097be95a3a03831a069`,
release title/notes and `threadatlas-0.1.0-alpha.0.tar.gz` are deliberately retained as historical
provenance. GitHub redirects the former repository URLs to the renamed repository; update clones'
remotes rather than relying on that indefinitely. Original measurements, reports and screenshots
remain dated alpha.0 observations, not regenerated or relabeled rename evidence. Original copyright
attribution is preserved in NOTICE. Compatibility aliases and these historical surfaces are
intentional remaining uses of the old name.
