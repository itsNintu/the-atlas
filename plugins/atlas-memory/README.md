# Atlas memory for Claude Code

A Claude Code plugin that gives Claude long-term Atlas memory, working the same way as the Hermes
`atlas-memory` plugin:

- **Automatic capture.** On `Stop` and `SessionEnd`, the plugin reads Claude Code's own session
  transcript and queues only genuine conversation: the prompts you type and Claude's reply text.
  Tool calls and results, thinking, injected reminders, slash-command wrappers and output, and
  notifications are never captured. The queue is a durable local SQLite outbox in the plugin data
  directory; each event's identity, revision and body are committed before delivery, and delivery
  replays the identical body, so outages lose nothing.
- **Pre-answer recall.** On `UserPromptSubmit`, one bounded `/v1/recall` request (no retries in the
  same turn) adds a compact memory packet to Claude's context. Failures are silent and audited locally.
- **MCP tools.** The bundled `atlas` server (`/mcp`) offers `recall`, `graph`, `forget` and `status`
  for lookups mid-task. Because capture is automatic, the model-relayed `remember` tool is hidden.

Every hook exits 0, so memory can never block a turn. Hooks need [Bun](https://bun.sh).

## Install

```
/plugin install atlas-memory --marketplace itsNintu/the-atlas
```

or from a shell:

```
claude plugin marketplace add itsNintu/the-atlas
claude plugin install atlas-memory@the-atlas
```

## Configure

The plugin does nothing until a credential file exists. An Atlas workspace administrator creates a
dedicated agent with `scripts/hosted-provision-agent.py`, writing the private mode-0600 file:

```
python3 scripts/hosted-provision-agent.py --url https://atlas.example.com \
  --admin-credential /path/to/admin.credentials.json \
  --agent claude-code --name "Claude Code" \
  --credential-file ~/.config/the-atlas/claude-code.json
```

Copy that file (mode 0600) to each host that should share the agent's memory. Optional settings live
in `~/.config/the-atlas/claude-code.settings.json`:

```json
{ "owner_author_id": "alex", "max_recall_tokens": 1200, "recall_timeout_seconds": 10, "retention_days": 30 }
```

`owner_author_id` attributes your typed prompts to the workspace owner, like the Hermes plugin's
explicit `owner_native_ids`; without it, prompts are attributed to `claude-code:user:unknown`. Set
`ATLAS_URL` if your Atlas is not at `https://atlas.creator.gg` (the MCP server URL), and
`ATLAS_CREDENTIAL_FILE` / `ATLAS_SETTINGS_FILE` to move the files.

Check the local state with `bun <plugin>/scripts/atlas.ts status`.
