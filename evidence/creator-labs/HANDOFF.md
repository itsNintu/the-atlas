# Atlas / Creator Labs branding source handoff

Task: t_683d62f7 · canonical repository `/home/alex/work/projects/the-atlas`.
Final Git commit is recorded in the task completion and downstream comments;
`source-manifest.json` pins source/asset bytes independently of that commit.

## Implemented

Both `/brain` and `/` now share Creator Labs' compact dark workspace system:
Space Grotesk body/headings, IBM Plex Mono controls/metadata, canonical ink/card/
muted/rule/control tokens, straight bounded panels and neutral routine actions.
The connection action uses approved top-right/bottom-left 11px cuts on visual
backings, retaining an unclipped focus ring and full hit area. There are zero
accent CTAs; #FF003D appears only as a small footer slash artifact and error rule.
The original unmirrored white Creator Labs symbol is separated from The Atlas
product identity by a rule. Parent/publisher naming is explicit in the footer.
Local fonts and original OFL notices plus official logo provenance are in
`ui/brand/`; `THIRD_PARTY.md` distinguishes font/trademark rights from code.

The existing native HTML/SVG composition and all backend memory/provider behavior
are retained. No React rewrite, licensed vendor source, new icon family, decorative
topology, fabricated status or product capability was added. Source/history detail,
accessible relationship list and graph semantics remain intact. Entity/literal
fill/dashes and historical edge dashes communicate state without brand color.

## Focused verification

- `bun run check`: pass.
- `bun scripts/brand-ui-test.ts`: pass, actual on-disk SQLite + authenticated HTTP
  + Chromium 140.0.7339.186. Fictional fixtures, not real Luna observations.
- 11 composition samples, 11 screenshots; desktop 1500x1100 brain and 1440x1000
  inspector, narrow 390x844 and 320x844. No document horizontal overflow.
- Official logo and three fonts byte-identical to canonical brand sources;
  correct CSS/SVG/font MIME + nosniff; exact allowlist excludes arbitrary files.
- Fonts actually loaded, neutral controls, zero accent CTAs, mobile fields 16px.
- Keyboard node selection, focus/reset, zoom/fit, source attribution/history,
  empty state, cross-view navigation and disconnect preserved.
- Inspector project/space creation, queue ingestion, source payload inspection,
  disclosure and correction-form edit transitions work against actual APIs.
- No page/console/CSP errors; credential not stored in cookies/storage/URL;
  reload disconnects. Production data/credentials never used in evidence.
- Screenshots visually inspected: bounded desktop/narrow composition, official
  symbol, neutral hover/focus, continuous diagonal edges. A 14px textarea and
  unnecessary narrow-header wrap found during QA were fixed and verified.
- `git diff --check`: pass. No dependency changes; recent frozen install and
  81-test/762-assertion memory acceptance from 9f0a24a are reused, not rerun.
  Original full graph behavior evidence remains `evidence/brain-view/browser.json`.

Raw results: `browser.json`; exact source hashes: `source-manifest.json`.

## Serving / remaining boundaries

This card completes source and focused visual verification, not production
activation or integrated Luna observation. No production lifecycle action was
performed here. `src/app.ts` changes only the exact public static allowlist and
MIME selection for `/brand.css`, the official SVG and three local fonts; CSP is
unchanged. An already-running process compiled with the old allowlist can serve
new disk HTML but 404 these new dependencies, so production needs the narrow
Overwatch serving continuation requested on activation t_cfe1d03e. Its live
unstyled screenshot is not this source's acceptance screenshot.

Do not repeat memory migration, model/capture/all-six/timing acceptance or gate
Reaver t_580a335f on branding. Reuse `atlas-native/activation/` for those phases.
Only verify the changed static bytes/MIME and actual rendered brand after the
necessary supported process activation; preserve database, source and credentials.

The graph's existing finite layout still fits the entire selected topology.
Wide/dense topology can produce small/overlapping labels, especially on phones;
focus a neighborhood, zoom, search/narrow scopes or use the full-label relationship
list and source inspector. No semantic distance or new layout guarantee is claimed.
This inherited practical limit is not concealed by decoration or invented edges.

Sibling generated `reports/e2e.json`, `reports/ui.json` and UI images were left
unstaged/untouched. Creators source was read only; no service restart/publication.
