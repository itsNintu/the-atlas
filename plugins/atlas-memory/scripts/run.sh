#!/bin/sh
# Locate Bun without assuming the hook environment's PATH. Never fail the turn.
dir=$(dirname "$0")
for b in "$(command -v bun 2>/dev/null)" "$HOME/.local/share/mise/shims/bun" "$HOME/.bun/bin/bun" /usr/local/bin/bun /opt/homebrew/bin/bun; do
  if [ -n "$b" ] && [ -x "$b" ]; then exec "$b" "$dir/atlas.ts" "$@"; fi
done
echo "atlas-memory: bun not found" >&2
exit 0
