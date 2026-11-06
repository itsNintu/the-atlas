# Security

This is a local-first alpha, not a hardened public multitenant hosted service. Bind to loopback by
default and protect the database/credentials with OS permissions. Use TLS and appropriate network
access/rate controls before exposing it. Treat a workspace admin and local database operator as
privileged. No provider key or bearer token should appear in issues, screenshots, commits or logs.

Report vulnerabilities privately using the repository's GitHub security reporting if enabled, or
contact the maintainer through GitHub before posting an exploit with real data. For an exposed token,
revoke it immediately via the credential endpoint or trusted local database administration and issue
a new file-only credential. Review access grants and protected backups. Rotating a provider key is a
provider operation, not a source correction.

Tests cover cross-workspace/personal/shared isolation, grant and credential revocation during async
operations, forgetting during provider work, and stale-job commit fencing. They are evidence for
specific behavior, not proof of absence of vulnerabilities. External model calls can process source
data and cannot be unsent; configure a provider consistent with your data-handling requirements.
