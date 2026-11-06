export const SCHEMA_VERSION = 1;
export const schema = `
CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS principals (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), name TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('human','agent','service')), is_admin INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS credentials (id TEXT PRIMARY KEY, principal_id TEXT NOT NULL REFERENCES principals(id), token_hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, revoked_at TEXT);
CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), name TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS spaces (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), project_id TEXT NOT NULL REFERENCES projects(id), name TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('personal','shared')), owner_id TEXT NOT NULL REFERENCES principals(id), created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS grants (space_id TEXT NOT NULL REFERENCES spaces(id), principal_id TEXT NOT NULL REFERENCES principals(id), action TEXT NOT NULL CHECK(action IN ('read','write','delete')), PRIMARY KEY(space_id,principal_id,action));
CREATE TABLE IF NOT EXISTS sources (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), space_id TEXT NOT NULL REFERENCES spaces(id), external_id TEXT NOT NULL, current_revision_id TEXT, created_at TEXT NOT NULL, deleted_at TEXT, UNIQUE(space_id,external_id));
CREATE TABLE IF NOT EXISTS revisions (id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES sources(id), revision_number INTEGER NOT NULL, format TEXT NOT NULL, mode TEXT NOT NULL, source_timestamp TEXT NOT NULL, payload_json TEXT, assertions_json TEXT, recorded_at TEXT NOT NULL, superseded_at TEXT, deleted_at TEXT, UNIQUE(source_id,revision_number));
CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, revision_id TEXT NOT NULL REFERENCES revisions(id), status TEXT NOT NULL CHECK(status IN ('queued','running','retry','succeeded','failed','cancelled')), attempts INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 5, available_at INTEGER NOT NULL, lease_until INTEGER, lease_token TEXT, error_code TEXT, created_at TEXT NOT NULL, completed_at TEXT);
CREATE INDEX IF NOT EXISTS jobs_ready ON jobs(status,available_at,lease_until);
CREATE TABLE IF NOT EXISTS facts (id TEXT PRIMARY KEY, space_id TEXT NOT NULL REFERENCES spaces(id), fingerprint TEXT NOT NULL, subject TEXT NOT NULL, predicate TEXT NOT NULL, object TEXT NOT NULL, valid_from TEXT NOT NULL, valid_to TEXT, embedding_json TEXT, embedding_model TEXT, UNIQUE(space_id,fingerprint));
CREATE TABLE IF NOT EXISTS supports (fact_id TEXT NOT NULL REFERENCES facts(id) ON DELETE CASCADE, revision_id TEXT NOT NULL REFERENCES revisions(id), recorded_from TEXT NOT NULL, recorded_to TEXT, PRIMARY KEY(fact_id,revision_id));
CREATE INDEX IF NOT EXISTS supports_revision ON supports(revision_id);
CREATE INDEX IF NOT EXISTS facts_space ON facts(space_id);
CREATE TABLE IF NOT EXISTS idempotency (principal_id TEXT NOT NULL REFERENCES principals(id), key TEXT NOT NULL, request_hash TEXT NOT NULL, response_json TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(principal_id,key));
CREATE TABLE IF NOT EXISTS audit (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, principal_id TEXT NOT NULL, request_id TEXT NOT NULL, operation TEXT NOT NULL, target_id TEXT, created_at TEXT NOT NULL);
`;
