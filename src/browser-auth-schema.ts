// Independent additive install, including the initialized Durable Object path.
export const browserAuthSchema = `
CREATE TABLE IF NOT EXISTS browser_accounts (
 identity_key TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 principal_id TEXT NOT NULL REFERENCES principals(id), explicit_binding INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS browser_agent_access (
 identity_key TEXT NOT NULL REFERENCES browser_accounts(identity_key),
 principal_id TEXT NOT NULL REFERENCES principals(id), PRIMARY KEY(identity_key,principal_id));
CREATE TABLE IF NOT EXISTS browser_login_transactions (
 cookie_hash TEXT PRIMARY KEY, state TEXT NOT NULL, verifier TEXT NOT NULL,
 expires_at INTEGER NOT NULL, consumed_at INTEGER);
CREATE TABLE IF NOT EXISTS browser_sessions (
 token_hash TEXT PRIMARY KEY, identity_key TEXT NOT NULL REFERENCES browser_accounts(identity_key),
 identity_json TEXT NOT NULL, grant_token TEXT, expires_at INTEGER NOT NULL, revoked_at TEXT);
CREATE TABLE IF NOT EXISTS browser_credentials (
 session_hash TEXT NOT NULL REFERENCES browser_sessions(token_hash),
 principal_id TEXT NOT NULL REFERENCES principals(id), credential_id TEXT NOT NULL REFERENCES credentials(id),
 PRIMARY KEY(session_hash,principal_id));
`;
